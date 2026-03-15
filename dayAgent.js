'use strict';

/**
 * dayAgent.js — Autonomous Day Trading Agent (server-side)
 *
 * Survives browser close. Stores state in MongoDB.
 * All times in Pakistan Standard Time (UTC+5, no DST).
 */

const crypto     = require('crypto');
const { AgentState, AgentSession, AgentTrade, AgentSettings, KimiSettings, BybitStore, Settings } = require('./models');
const { runScan } = require('./coinScanner');
const notifier        = require('./notifier');
const discordNotifier = require('./discordNotifier');

const PST_OFFSET_MS = 5 * 60 * 60 * 1000; // UTC+5

let _activeUserId = null; // tracks the running agent's user, used to scope Socket.io emits

// ── PST helpers ───────────────────────────────────────────────

function nowPST()    { return new Date(Date.now() + PST_OFFSET_MS); }
function pstTimeStr() {
    const d = nowPST();
    return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
}
function todayPST() {
    const d = nowPST();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}
function minsUntilEndOfDay(endTime = '18:00') {
    const [eh, em] = endTime.split(':').map(Number);
    const d = nowPST();
    return (eh * 60 + em) - (d.getUTCHours() * 60 + d.getUTCMinutes());
}

// ── Bybit API helpers ─────────────────────────────────────────

async function getCreds(uid) {
    const doc = await BybitStore.findOne({ userId: uid }).lean();
    if (!doc) return null;
    const env = doc.activeEnv || 'mainnet';
    const c   = doc[env];
    if (!c?.apiKey || !c?.apiSecret) return null;
    return { apiKey: c.apiKey, apiSecret: c.apiSecret, env };
}

function hmac(secret, msg) {
    return crypto.createHmac('sha256', secret).update(msg).digest('hex');
}

async function bybitReq(creds, method, path, params = {}, body = null) {
    const base = creds.env === 'testnet' ? 'https://api-demo.bybit.com' : 'https://api.bybit.com';
    const ts   = Date.now().toString();
    const recv = '20000';
    let signStr, url;
    if (method === 'GET') {
        const qs = new URLSearchParams(params).toString();
        signStr  = ts + creds.apiKey + recv + qs;
        url      = base + path + (qs ? '?' + qs : '');
    } else {
        const bs = JSON.stringify(body || params);
        signStr  = ts + creds.apiKey + recv + bs;
        url      = base + path;
    }
    const sign = hmac(creds.apiSecret, signStr);
    const hdrs = {
        'X-BAPI-API-KEY': creds.apiKey, 'X-BAPI-SIGN': sign,
        'X-BAPI-TIMESTAMP': ts, 'X-BAPI-RECV-WINDOW': recv,
        'Content-Type': 'application/json',
    };
    const opts = { method, headers: hdrs };
    if (method !== 'GET') opts.body = JSON.stringify(body || params);
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
}

async function getBalance(creds) {
    const r = await bybitReq(creds, 'GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' });
    if (r.retCode !== 0) throw new Error(r.retMsg);
    return parseFloat(r.result?.list?.[0]?.totalEquity) || 0;
}

async function getOpenPosition(creds, symbol) {
    try {
        const r = await bybitReq(creds, 'GET', '/v5/position/list', { category: 'linear', symbol });
        const p = (r.result?.list || []).find(x => +x.size > 0);
        if (!p) return null;
        return { size: +p.size, avgPrice: +p.avgPrice, side: p.side, unrealisedPnl: +p.unrealisedPnl, symbol };
    } catch { return null; }
}

function roundToStep(val, step) {
    const dec = (step.toString().split('.')[1] || '').length;
    return parseFloat((Math.floor(val / step) * step).toFixed(dec));
}

async function getInstrumentInfo(sym) {
    try {
        const r = await fetch(`https://api.bybit.com/v5/market/instrument-info?category=linear&symbol=${sym}`);
        const d = await r.json();
        const i = d.result?.list?.[0];
        return {
            qtyStep: parseFloat(i?.lotSizeFilter?.qtyStep     || '0.001'),
            minQty:  parseFloat(i?.lotSizeFilter?.minOrderQty || '0.001'),
        };
    } catch { return { qtyStep: 0.001, minQty: 0.001 }; }
}

// ── Socket.io emit ────────────────────────────────────────────

let _io = null;
function setIO(io) { _io = io; }

function emit(event, data) {
    if (!_io) return;
    const payload = { ...data, ts: new Date().toISOString() };
    if (_activeUserId) _io.to(_activeUserId).emit(event, payload);
    else _io.emit(event, payload);
}

function agLog(level, message) {
    console.log(`[Agent][${level.toUpperCase()}] ${message}`);
    emit('agent:log', { level, message, ts: pstTimeStr() });
}

// ── DB state helpers ──────────────────────────────────────────

async function dbSaveState(uid, update) {
    await AgentState.findOneAndUpdate({ userId: uid }, { $set: update }, { upsert: true });
}

// ── DayAgent class ────────────────────────────────────────────

class DayAgent {
    constructor() {
        this.userId            = null;
        this.running           = false;
        this.status            = 'idle';
        this.sessionId         = null;
        this.tradesTaken       = 0;
        this.wins              = 0;
        this.losses            = 0;
        this.totalPnl          = 0;
        this.startBalance      = 0;
        this.consecutiveLosses = 0;
        this.currentTrade      = null;
        this.settings          = {};
        this._scanTimer        = null;
        this._monitorTimer     = null;
        this._shutdownTimer    = null;
    }

    async start(userId) {
        if (this.running) return { ok: false, error: 'Agent already running' };
        this.userId = userId;
        _activeUserId = userId;

        const settingsDoc = await AgentSettings.findOne({ userId: this.userId }).lean();
        this.settings = settingsDoc || {};

        const creds = await getCreds(this.userId);
        if (!creds) return { ok: false, error: 'Bybit API credentials not configured' };

        const minsLeft = minsUntilEndOfDay(this.settings.endTime || '18:00');
        if (minsLeft <= 0) return { ok: false, error: 'Past configured trading end time' };

        const today   = todayPST();
        let session   = await AgentSession.findOne({ userId: this.userId, date: today });
        if (!session) {
            this.startBalance = await getBalance(creds);
            session = await AgentSession.create({
                userId: this.userId, date: today,
                startBalance: this.startBalance,
                startedAt: new Date().toISOString(),
                maxTrades: this.settings.maxTrades || 3,
            });
        } else {
            this.startBalance      = session.startBalance || 0;
            this.tradesTaken       = session.tradesTaken  || 0;
            this.wins              = session.wins          || 0;
            this.losses            = session.losses        || 0;
            this.totalPnl          = parseFloat(session.totalPnl) || 0;
            this.consecutiveLosses = session.consecutiveLosses || 0;
        }
        this.sessionId = session._id.toString();

        const maxTrades = this.settings.maxTrades || 3;
        if (this.tradesTaken >= maxTrades) return { ok: false, error: 'Max trades already reached for today' };

        this.running = true;
        this.status  = 'scanning';
        await dbSaveState(this.userId, { running: true, status: 'scanning', sessionId: this.sessionId, date: today, tradesTaken: this.tradesTaken, startBalance: this.startBalance });

        this._scheduleShutdown();

        if (this.settings.notifyOnAgentShutdown !== false) {
            notifier.notifyAgentStarted(this.settings).catch(() => {});
        }
        discordNotifier.sendAgentAlert(this.userId, 'agent_start', {
            mode:      'Live',
            timeframe: this.settings.timeframe || '5m',
            minScore:  this.settings.minScore  || 75,
            maxTrades: this.settings.maxTrades || 3,
        }).catch(() => {});

        emit('agent:started', { tradesTaken: this.tradesTaken, maxTrades, startBalance: this.startBalance });
        agLog('success', `Agent started. Balance: $${this.startBalance.toFixed(2)} | Trades: ${this.tradesTaken}/${maxTrades}`);
        agLog('info', `Settings — minScore: ${this.settings.minScore || 75}, maxTrades: ${this.settings.maxTrades || 3}, DD limit: ${this.settings.dailyDrawdownPct || 5}%, position size: ${this.settings.basePositionSize || 'auto (risk-based)'}`);

        // Resume open trade if any
        const openTrade = await AgentTrade.findOne({
            sessionId: this.sessionId, userId: this.userId, closedAt: { $exists: false },
        });
        if (openTrade) {
            this.currentTrade = openTrade;
            this.status = 'in_trade';
            agLog('info', `Resuming with open trade: ${openTrade.symbol}`);
            this._startMonitor();
        } else {
            // Respect scan interval on resume — calculate remaining time from last scan
            const state = await AgentState.findOne({ userId: this.userId }).lean();
            const lastScan = state?.lastScanAt ? new Date(state.lastScanAt).getTime() : 0;
            const elapsed = lastScan ? (Date.now() - lastScan) / 1000 : Infinity;
            const scanIntervalSec = (this.settings.scanInterval || 30) * 60;
            const delay = Math.max(0, scanIntervalSec - elapsed);
            this._startScan(delay > 30 ? delay : 0);
        }

        return { ok: true };
    }

    async stop(reason = 'manual') {
        this._clearTimers();
        this.running = false;
        this.status  = 'idle';

        let endBalance = this.startBalance;
        try {
            const creds = await getCreds(this.userId);
            if (creds) endBalance = await getBalance(creds);
        } catch {}

        if (this.sessionId) {
            await AgentSession.findByIdAndUpdate(this.sessionId, {
                $set: {
                    endBalance, endedAt: new Date().toISOString(), endReason: reason,
                    tradesTaken: this.tradesTaken, wins: this.wins, losses: this.losses, totalPnl: this.totalPnl,
                },
            });
        }

        await dbSaveState(this.userId, { running: false, status: 'idle' });

        try {
            if (this.sessionId && this.settings.notifyOnDailySummary !== false) {
                const session = await AgentSession.findById(this.sessionId).lean();
                const trades  = await AgentTrade.find({ sessionId: this.sessionId, userId: this.userId }).lean();
                if (session) {
                    await notifier.notifyDailySummary({ ...session, endBalance, endReason: reason }, trades);
                }
            }
        } catch {}

        emit('agent:stopped', { reason, totalPnl: this.totalPnl, tradesTaken: this.tradesTaken });
        agLog('warn', `Agent stopped. Reason: ${reason} | PnL: ${this.totalPnl >= 0 ? '+' : ''}$${this.totalPnl.toFixed(2)}`);
        _activeUserId = null;
        agentInstance = null;
    }

    _clearTimers() {
        if (this._scanTimer)     { clearTimeout(this._scanTimer);     this._scanTimer    = null; }
        if (this._monitorTimer)  { clearInterval(this._monitorTimer);  this._monitorTimer = null; }
        if (this._shutdownTimer) { clearTimeout(this._shutdownTimer);  this._shutdownTimer = null; }
    }

    _scheduleShutdown() {
        const minsLeft = minsUntilEndOfDay(this.settings.endTime || '18:00');
        if (minsLeft <= 0) { this.stop('end_time_cutoff'); return; }
        this._shutdownTimer = setTimeout(() => this.stop('end_time_cutoff'), minsLeft * 60 * 1000);
        agLog('info', `Auto-shutdown in ${minsLeft} min (${this.settings.endTime || '18:00'} PST)`);
    }

    _startScan(delaySec = 0) {
        if (!this.running) return;
        this.status = 'scanning';
        emit('agent:status_update', this._statusObj());
        if (delaySec > 0) {
            agLog('info', `Next scan in ${Math.round(delaySec / 60)} min...`);
            this._scanTimer = setTimeout(() => this._doScan(), delaySec * 1000);
        } else {
            setImmediate(() => this._doScan());
        }
    }

    async _doScan() {
        if (!this.running) return;

        // Re-fetch latest agent settings each scan cycle so user changes take effect without restart
        this.settings = await AgentSettings.findOne({ userId: this.userId }).lean() || this.settings;
        // Record scan time so resume/restart can respect the scan interval
        await dbSaveState(this.userId, { lastScanAt: new Date().toISOString() });

        const maxTrades = this.settings.maxTrades || 3;
        if (this.tradesTaken >= maxTrades) { await this.stop('max_trades_reached'); return; }

        // Consecutive losses guardrail
        const maxCL = this.settings.maxConsecutiveLosses || 3;
        if (this.consecutiveLosses >= maxCL) {
            this.status = 'paused';
            emit('agent:paused', { reason: 'consecutive_losses' });
            agLog('warn', `${this.consecutiveLosses} consecutive losses — pausing for the day`);
            await this.stop('consecutive_losses');
            return;
        }

        // Daily drawdown guardrail
        try {
            const creds = await getCreds(this.userId);
            if (creds && this.startBalance > 0) {
                const bal = await getBalance(creds);
                const dd  = ((this.startBalance - bal) / this.startBalance) * 100;
                if (dd >= (this.settings.dailyDrawdownPct || 5)) {
                    agLog('error', `Daily drawdown limit hit: ${dd.toFixed(2)}%`);
                    await this.stop('daily_drawdown');
                    return;
                }
            }
        } catch {}

        const scanInterval = (this.settings.scanInterval || 30) * 60;
        const creds        = await getCreds(this.userId);

        // Get user AI settings (with migration from legacy KimiSettings)
        let userSettings = await Settings.findOne({ userId: this.userId }).lean() || {};
        if (!userSettings.ai?.kimiApiKey) {
            const legacy = await KimiSettings.findOne({ userId: this.userId }).lean();
            if (legacy?.apiKey) {
                if (!userSettings.ai) userSettings.ai = {};
                userSettings.ai.kimiApiKey = legacy.apiKey;
            }
        }

        try {
            const qualified = await runScan(creds, this.settings, userSettings, emit);
            if (!qualified.length) {
                agLog('info', `No qualifying setups. Rescanning in ${this.settings.scanInterval || 30} min`);
                this._startScan(scanInterval);
                return;
            }
            await this._executeTrade(qualified[0], creds);
        } catch (e) {
            agLog('error', `Scan error: ${e.message}`);
            this._startScan(scanInterval);
        }
    }

    async _executeTrade(setup, creds) {
        if (!this.running) return;
        agLog('info', `Executing ${setup.direction.toUpperCase()} on ${setup.symbol} | score=${setup.score}`);

        if (this.settings.notifyOnTradePlaced !== false) {
            notifier.notifyPreTrade(setup).catch(() => {});
        }

        try {
            const balance              = await getBalance(creds);
            const { qtyStep, minQty } = await getInstrumentInfo(setup.symbol);

            let qty;
            const baseSize = parseFloat(this.settings.basePositionSize) || 0;
            if (baseSize > 0) {
                qty = roundToStep(baseSize / setup.entry, qtyStep);
            } else {
                const riskAmt = balance * ((this.settings.maxLossPerTradePct || 1) / 100);
                const slDist  = Math.abs(setup.entry - setup.sl);
                qty = slDist > 0 ? roundToStep(riskAmt / slDist, qtyStep) : 0;
            }

            if (!qty || qty < minQty) {
                agLog('error', `Qty too small (${qty}, min=${minQty}) for ${setup.symbol}. Skipping.`);
                this._startScan(300);
                return;
            }

            // Set leverage
            try {
                await bybitReq(creds, 'POST', '/v5/position/set-leverage', {}, {
                    category: 'linear', symbol: setup.symbol, buyLeverage: '10', sellLeverage: '10',
                });
            } catch {}

            const side = setup.direction === 'long' ? 'Buy' : 'Sell';
            const r    = await bybitReq(creds, 'POST', '/v5/order/create', {}, {
                category: 'linear', symbol: setup.symbol, side,
                orderType: 'Market', qty: qty.toString(), timeInForce: 'IOC',
                stopLoss: setup.sl.toString(), takeProfit: setup.tp1.toString(),
                slTriggerBy: 'MarkPrice', tpTriggerBy: 'MarkPrice',
            });

            if (r.retCode !== 0) {
                agLog('error', `Order rejected: ${r.retMsg}`);
                this._startScan(300);
                return;
            }

            const tradeDoc = await AgentTrade.create({
                userId: this.userId, sessionId: this.sessionId,
                symbol: setup.symbol, side: setup.direction,
                entryPrice: setup.entry, sl: setup.sl, tp: setup.tp1,
                aiScore: setup.score, aiConfidence: setup.confidence, aiReasoning: setup.reasoning,
                openedAt: new Date().toISOString(),
            });

            this.currentTrade = tradeDoc;
            this.tradesTaken++;
            this.status = 'in_trade';
            await dbSaveState(this.userId, { status: 'in_trade', tradesTaken: this.tradesTaken });
            await AgentSession.findByIdAndUpdate(this.sessionId, { $set: { tradesTaken: this.tradesTaken } });

            emit('agent:trade_placed', {
                symbol: setup.symbol, direction: setup.direction,
                entry: setup.entry, sl: setup.sl, tp: setup.tp1, score: setup.score, qty,
            });
            agLog('success', `Trade placed: ${setup.symbol} ${setup.direction.toUpperCase()} qty=${qty}`);
            discordNotifier.sendAgentAlert(this.userId, 'trade_placed', {
                symbol:    setup.symbol,
                direction: setup.direction,
                score:     setup.score,
                entry:     setup.entry,
                sl:        setup.sl,
                tp:        setup.tp1,
                qty,
                reasoning: setup.reasoning,
            }).catch(() => {});
            this._startMonitor();

        } catch (e) {
            agLog('error', `Trade execution failed: ${e.message}`);
            this._startScan((this.settings.scanInterval || 30) * 60);
        }
    }

    _startMonitor() {
        if (this._monitorTimer) clearInterval(this._monitorTimer);
        this._monitorTimer = setInterval(() => this._checkPosition(), 15000);
    }

    async _checkPosition() {
        if (!this.running || !this.currentTrade) return;
        try {
            const creds = await getCreds(this.userId);
            if (!creds) return;

            const pos = await getOpenPosition(creds, this.currentTrade.symbol);
            if (!pos) {
                await this._handleTradeClosed(creds);
                return;
            }

            // Per-trade max loss guardrail
            const balance    = await getBalance(creds);
            const maxLossAmt = -(balance * (this.settings.maxLossPerTradePct || 1) / 100);
            if (pos.unrealisedPnl < maxLossAmt) {
                agLog('warn', `Max loss hit on ${this.currentTrade.symbol} (${pos.unrealisedPnl.toFixed(2)} USDT). Force closing.`);
                await this._forceClose(creds, pos);
                return;
            }

            // Time-in-loss guardrail (>20 × 5m candles ≈ 100 min)
            const elapsedMin = (Date.now() - new Date(this.currentTrade.openedAt).getTime()) / 60000;
            if (elapsedMin > 100 && pos.unrealisedPnl < 0) {
                agLog('warn', `${this.currentTrade.symbol} in loss >20 candles. Force closing.`);
                await this._forceClose(creds, pos);
                return;
            }

            emit('agent:status_update', this._statusObj());
        } catch (e) {
            agLog('warn', `Monitor error: ${e.message}`);
        }
    }

    async _forceClose(creds, pos) {
        try {
            const cs = pos.side === 'Buy' ? 'Sell' : 'Buy';
            await bybitReq(creds, 'POST', '/v5/order/create', {}, {
                category: 'linear', symbol: pos.symbol, side: cs,
                orderType: 'Market', qty: pos.size.toString(), timeInForce: 'IOC', reduceOnly: true,
            });
            agLog('info', `Force close submitted for ${pos.symbol}`);
            setTimeout(() => this._handleTradeClosed(creds), 3000);
        } catch (e) {
            agLog('error', `Force close failed: ${e.message}`);
        }
    }

    async _handleTradeClosed(creds) {
        if (this._monitorTimer) { clearInterval(this._monitorTimer); this._monitorTimer = null; }
        const trade = this.currentTrade;
        this.currentTrade = null;

        let closePrice = trade.entryPrice, pnl = 0;
        try {
            const r      = await bybitReq(creds, 'GET', '/v5/position/closed-pnl', { category: 'linear', symbol: trade.symbol, limit: 5 });
            const closed = r.result?.list?.[0];
            if (closed) {
                pnl        = parseFloat(closed.closedPnl)     || 0;
                closePrice = parseFloat(closed.avgExitPrice)  || trade.entryPrice;
            }
        } catch {}

        const pnlPct = this.startBalance > 0 ? (pnl / this.startBalance) * 100 : 0;
        const isWin  = pnl >= 0;
        if (isWin) { this.wins++; this.consecutiveLosses = 0; }
        else       { this.losses++; this.consecutiveLosses++; }
        this.totalPnl += pnl;

        await AgentTrade.findByIdAndUpdate(trade._id, {
            $set: { closePrice, pnl: parseFloat(pnl.toFixed(4)), pnlPercent: parseFloat(pnlPct.toFixed(2)), closedAt: new Date().toISOString() },
        });
        await AgentSession.findByIdAndUpdate(this.sessionId, {
            $set: { wins: this.wins, losses: this.losses, totalPnl: this.totalPnl, consecutiveLosses: this.consecutiveLosses },
        });

        const result = { symbol: trade.symbol, direction: trade.side, entryPrice: trade.entryPrice, closePrice, pnl, pnlPercent: pnlPct, aiScore: trade.aiScore };
        emit('agent:trade_closed', result);
        agLog(isWin ? 'success' : 'error', `Trade closed ${trade.symbol}: ${isWin ? 'WIN' : 'LOSS'} PnL=${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`);

        if (this.settings.notifyOnTradeClosed !== false) {
            notifier.notifyTradeClosed(result, this.tradesTaken, this.settings.maxTrades || 3).catch(() => {});
        }
        discordNotifier.sendAgentAlert(this.userId, isWin ? 'tp_hit' : 'sl_hit', {
            symbol:     trade.symbol,
            direction:  trade.side,
            aiScore:    trade.aiScore,
            entryPrice: trade.entryPrice,
            closePrice,
            pnl,
            pnlPercent: pnlPct,
        }).catch(() => {});

        const maxTrades = this.settings.maxTrades || 3;
        if (this.tradesTaken >= maxTrades) { await this.stop('max_trades_reached'); return; }

        const cooldown = (this.settings.cooldownMinutes || 15) * 60;
        agLog('info', `Cooldown ${this.settings.cooldownMinutes || 15} min before next scan`);
        this._startScan(cooldown);
    }

    _statusObj() {
        return {
            running: this.running, status: this.status,
            tradesTaken: this.tradesTaken, maxTrades: this.settings.maxTrades || 3,
            wins: this.wins, losses: this.losses, totalPnl: this.totalPnl,
            startBalance: this.startBalance, consecutiveLosses: this.consecutiveLosses,
            pstTime: pstTimeStr(), sessionId: this.sessionId,
            currentTrade: this.currentTrade ? {
                symbol: this.currentTrade.symbol, direction: this.currentTrade.side,
                entry: this.currentTrade.entryPrice, sl: this.currentTrade.sl, tp: this.currentTrade.tp,
                score: this.currentTrade.aiScore, openedAt: this.currentTrade.openedAt,
            } : null,
        };
    }

    getStatus() { return this._statusObj(); }
}

// ── Singleton public API ──────────────────────────────────────

let agentInstance = null;

async function startAgent(userId) {
    if (agentInstance) return { ok: false, error: 'Agent already running' };
    agentInstance = new DayAgent();
    const result = await agentInstance.start(userId);
    if (!result.ok) agentInstance = null;
    return result;
}

async function stopAgent(reason = 'manual') {
    if (!agentInstance) return { ok: false, error: 'No agent running' };
    await agentInstance.stop(reason);
    return { ok: true };
}

function getStatus() {
    if (!agentInstance) return { running: false, status: 'idle', pstTime: pstTimeStr() };
    return agentInstance.getStatus();
}

async function resumeOnBoot() {
    try {
        const states = await AgentState.find({ running: true }).lean();
        for (const state of states) {
            if (!state?.userId) continue;
            if (state.date !== todayPST()) continue;
            if (minsUntilEndOfDay() <= 0) continue;
            console.log(`[Agent] Resuming session for user ${state.userId}…`);
            agentInstance = new DayAgent();
            const result = await agentInstance.start(state.userId);
            if (!result.ok) agentInstance = null;
        }
    } catch (e) {
        console.error('[Agent] Resume error:', e.message);
    }
}

module.exports = { startAgent, stopAgent, getStatus, setIO, resumeOnBoot };
