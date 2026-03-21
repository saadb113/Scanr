'use strict';

/**
 * dayAgent.js — AI Day Trading Agent (server-side, candle-based)
 *
 * Architecture:
 * - Module-level Map keyed by userId — one agent instance per user
 * - Scans on candle close of the selected timeframe (polls every 30s)
 * - Survives tab close and server restarts (PM2 + DB state persistence)
 * - Fresh settings fetched from DB on every poll cycle
 * - All times in Pakistan Standard Time (UTC+5, no DST)
 */

const crypto     = require('crypto');
const { AgentState, AgentSession, AgentTrade, AgentSettings, KimiSettings, BybitStore, Settings } = require('./models');
const { runScan } = require('./coinScanner');
const notifier        = require('./notifier');
const discordNotifier = require('./discordNotifier');

const PST_OFFSET_MS = 5 * 60 * 60 * 1000; // UTC+5

// Candle duration in milliseconds per timeframe
const TF_MS = {
    '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000, '30m': 1800000,
    '1h': 3600000, '2h': 7200000, '4h': 14400000, '1D': 86400000,
};

// Module-level agents Map — one entry per running user
const agents = new Map();

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
function pstMinutes() {
    const d = nowPST();
    return d.getUTCHours() * 60 + d.getUTCMinutes();
}
function timeToMins(timeStr) {
    const [h, m] = (timeStr || '00:00').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
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
        const r = await fetch(`https://fapi.binance.com/fapi/v1/exchangeInfo?symbol=${sym}`);
        const d = await r.json();
        const i = d.symbols?.[0];
        const lot = (i?.filters || []).find(f => f.filterType === 'LOT_SIZE') || {};
        return {
            qtyStep: parseFloat(lot.stepSize || '0.001'),
            minQty:  parseFloat(lot.minQty || '0.001'),
        };
    } catch { return { qtyStep: 0.001, minQty: 0.001 }; }
}

// ── Socket.io emit ────────────────────────────────────────────

let _io = null;
function setIO(io) { _io = io; }

function emit(userId, event, data) {
    if (!_io) return;
    const payload = { ...data, ts: new Date().toISOString() };
    _io.to(userId).emit(event, payload);
}

// ── DB state helpers ──────────────────────────────────────────

async function dbSaveState(uid, update) {
    await AgentState.findOneAndUpdate({ userId: uid }, { $set: update }, { upsert: true });
}

// ── Candle-close detection ────────────────────────────────────

function candleEpoch(tf) {
    const ms = TF_MS[tf] || 300000;
    return Math.floor(Date.now() / ms);
}

// ── DayAgent class ────────────────────────────────────────────

class DayAgent {
    constructor(userId) {
        this.userId            = userId;
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
        this._pollTimer        = null;   // candle-close poller (setInterval 30s)
        this._monitorTimer     = null;   // position monitor (setInterval 30s)
        this._shutdownTimer    = null;   // auto-stop at end time
        this._lastCandleEpoch  = 0;      // last scanned candle epoch
        this._scanning         = false;  // prevents concurrent scans
        this._lastScanAt       = null;   // ISO timestamp of last scan
    }

    log(level, msg) {
        const ts = pstTimeStr();
        console.log(`[Agent][${level.toUpperCase()}] ${msg}`);
        emit(this.userId, 'agent:log', { level, message: msg, ts });
    }

    async start() {
        if (this.running) return { ok: false, error: 'Agent already running' };

        // Load settings fresh from DB
        this.settings = await AgentSettings.findOne({ userId: this.userId }).lean() || {};

        // Check Bybit credentials
        const creds = await getCreds(this.userId);
        if (!creds) return { ok: false, error: 'Bybit API credentials not configured' };

        // Check trading end time
        const nowMins = pstMinutes();
        const endMins = timeToMins(this.settings.endTime || '18:00');
        if (nowMins >= endMins) return { ok: false, error: 'Past configured trading end time' };

        // Resume or create today's session
        const today  = todayPST();
        let session  = await AgentSession.findOne({ userId: this.userId, date: today });
        if (!session) {
            this.startBalance = await getBalance(creds);
            session = await AgentSession.create({
                userId: this.userId, date: today,
                startBalance: this.startBalance,
                startedAt: new Date().toISOString(),
                maxTrades: this.settings.maxTrades || 3,
            });
        } else {
            this.startBalance      = session.startBalance      || 0;
            this.tradesTaken       = session.tradesTaken       || 0;
            this.wins              = session.wins              || 0;
            this.losses            = session.losses            || 0;
            this.totalPnl          = parseFloat(session.totalPnl) || 0;
            this.consecutiveLosses = session.consecutiveLosses || 0;
        }
        this.sessionId = session._id.toString();

        const maxTrades = this.settings.maxTrades || 3;
        if (this.tradesTaken >= maxTrades) return { ok: false, error: 'Max trades already reached for today' };

        this.running = true;
        this.status  = 'scanning';

        const tf   = this.settings.timeframe || '15m';
        const demo = this.settings.demoMode ? 'DEMO' : 'LIVE';

        await dbSaveState(this.userId, {
            running: true, status: 'scanning', sessionId: this.sessionId,
            date: today, tradesTaken: this.tradesTaken, startBalance: this.startBalance,
        });

        discordNotifier.sendAgentAlert(this.userId, 'agent_start', {
            mode: demo, timeframe: tf,
            minScore: this.settings.minScore || 75,
            maxTrades,
        }).catch(() => {});

        emit(this.userId, 'agent:started', { tradesTaken: this.tradesTaken, maxTrades, startBalance: this.startBalance });
        this.log('success', `AI Agent started — scanning ${tf} — min score: ${this.settings.minScore || 75} — mode: ${demo}`);
        this.log('info', `Trading window: ${this.settings.startTime || '08:00'}–${this.settings.endTime || '18:00'} PKT | maxTrades: ${maxTrades} | DD limit: ${this.settings.dailyDrawdownPct || 5}%`);

        // Schedule auto-shutdown at end time
        this._scheduleShutdown();

        // Resume open trade if any
        const openTrade = await AgentTrade.findOne({
            sessionId: this.sessionId, userId: this.userId, closedAt: { $exists: false },
        });
        if (openTrade) {
            this.currentTrade = openTrade;
            this.status = 'in_trade';
            this.log('info', `Resuming with open trade: ${openTrade.symbol}`);
            this._startMonitor();
        } else {
            this._startPoller();
        }

        return { ok: true };
    }

    async stop(reason = 'manual') {
        this._clearTimers();
        this.running   = false;
        this.status    = 'idle';
        this._scanning = false;

        let endBalance = this.startBalance;
        try {
            const creds = await getCreds(this.userId);
            if (creds) endBalance = await getBalance(creds);
        } catch {}

        if (this.sessionId) {
            await AgentSession.findByIdAndUpdate(this.sessionId, {
                $set: {
                    endBalance, endedAt: new Date().toISOString(), endReason: reason,
                    tradesTaken: this.tradesTaken, wins: this.wins,
                    losses: this.losses, totalPnl: this.totalPnl,
                },
            });
        }

        await dbSaveState(this.userId, { running: false, status: 'idle' });

        try {
            if (this.sessionId && this.settings.notifyOnDailySummary !== false) {
                const session = await AgentSession.findById(this.sessionId).lean();
                const trades  = await AgentTrade.find({ sessionId: this.sessionId, userId: this.userId }).lean();
                if (session) await notifier.notifyDailySummary({ ...session, endBalance, endReason: reason }, trades);
            }
        } catch {}

        emit(this.userId, 'agent:stopped', { reason, totalPnl: this.totalPnl, tradesTaken: this.tradesTaken });
        this.log('warn', `Agent stopped. Reason: ${reason} | PnL: ${this.totalPnl >= 0 ? '+' : ''}$${this.totalPnl.toFixed(2)}`);
        agents.delete(this.userId);
    }

    _clearTimers() {
        if (this._pollTimer)     { clearInterval(this._pollTimer);    this._pollTimer     = null; }
        if (this._monitorTimer)  { clearInterval(this._monitorTimer);  this._monitorTimer  = null; }
        if (this._shutdownTimer) { clearTimeout(this._shutdownTimer);  this._shutdownTimer = null; }
    }

    _scheduleShutdown() {
        const nowMins  = pstMinutes();
        const endMins  = timeToMins(this.settings.endTime || '18:00');
        const minsLeft = endMins - nowMins;
        if (minsLeft <= 0) { this.stop('end_time_cutoff'); return; }
        this._shutdownTimer = setTimeout(() => this.stop('end_time_cutoff'), minsLeft * 60000);
        this.log('info', `Auto-shutdown in ${minsLeft} min (${this.settings.endTime || '18:00'} PKT)`);
    }

    _startPoller() {
        if (this._pollTimer) clearInterval(this._pollTimer);
        // Init epoch now so we don't immediately scan on first tick
        const tf = this.settings.timeframe || '15m';
        this._lastCandleEpoch = candleEpoch(tf);
        this._pollTimer = setInterval(() => this._poll(), 30000);
        this.log('info', `Candle poller active — waiting for ${tf} close`);
    }

    async _poll() {
        if (!this.running || this._scanning || this.currentTrade) return;

        // Re-fetch settings each cycle so live changes take effect without restart
        this.settings = await AgentSettings.findOne({ userId: this.userId }).lean() || this.settings;

        const tf    = this.settings.timeframe || '15m';
        const epoch = candleEpoch(tf);

        // No new candle yet
        if (epoch === this._lastCandleEpoch) return;
        this._lastCandleEpoch = epoch;

        // Trading hours check
        const nowMins   = pstMinutes();
        const startMins = timeToMins(this.settings.startTime || '08:00');
        const endMins   = timeToMins(this.settings.endTime   || '18:00');
        if (nowMins < startMins || nowMins >= endMins) {
            this.log('info', `Outside trading hours (${pstTimeStr()} PKT) — skipping scan`);
            return;
        }

        await this._doScan();
    }

    async _doScan() {
        if (!this.running || this._scanning) return;
        this._scanning = true;

        const maxTrades = this.settings.maxTrades || 3;

        // Guardrail: max trades reached
        if (this.tradesTaken >= maxTrades) {
            this.log('warn', `Max trades reached for today — agent paused until midnight PKT`);
            await this.stop('max_trades_reached');
            return;
        }

        // Guardrail: consecutive losses
        const maxCL = this.settings.maxConsecutiveLosses || 3;
        if (this.consecutiveLosses >= maxCL) {
            this.log('warn', `${this.consecutiveLosses} consecutive losses — stopping for the day`);
            await this.stop('consecutive_losses');
            return;
        }

        // Guardrail: daily drawdown
        try {
            const creds = await getCreds(this.userId);
            if (creds && this.startBalance > 0) {
                const bal = await getBalance(creds);
                const dd  = ((this.startBalance - bal) / this.startBalance) * 100;
                if (dd >= (this.settings.dailyDrawdownPct || 5)) {
                    this.log('error', `Daily drawdown limit hit: ${dd.toFixed(2)}%`);
                    await this.stop('daily_drawdown');
                    return;
                }
            }
        } catch {}

        await dbSaveState(this.userId, { lastScanAt: new Date().toISOString() });
        this._lastScanAt = new Date().toISOString();
        emit(this.userId, 'agent:status_update', this._statusObj());

        // Get user AI settings (with legacy Kimi migration)
        let userSettings = await Settings.findOne({ userId: this.userId }).lean() || {};
        if (!userSettings.ai?.kimiApiKey) {
            const legacy = await KimiSettings.findOne({ userId: this.userId }).lean();
            if (legacy?.apiKey) {
                if (!userSettings.ai) userSettings.ai = {};
                userSettings.ai.kimiApiKey = legacy.apiKey;
            }
        }

        const creds = await getCreds(this.userId);
        const tf    = this.settings.timeframe || '15m';

        try {
            const coins = this._getCoinList();
            this.log('info', `Scanning ${coins.length} coins on ${tf}`);

            const qualified = await runScan(creds, this.settings, userSettings,
                (ev, d) => emit(this.userId, ev, d));

            if (!qualified.length) {
                this.log('info', `No qualifying coins this cycle — waiting for next ${tf} candle`);
            } else {
                const best = qualified[0]; // already sorted by score desc
                this.log('success', `Best setup: ${best.symbol} ${(best.direction || '').toUpperCase()} — score: ${best.score}`);
                await this._executeTrade(best, creds);
            }
        } catch (e) {
            this.log('error', `Scan error: ${e.message}`);
        } finally {
            this._scanning = false;
        }
    }

    _getCoinList() {
        const customList = (this.settings.customCoins || '').trim();
        if (customList) return customList.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        return [];
    }

    async _executeTrade(setup, creds) {
        if (!this.running) return;
        const demo = !!this.settings.demoMode;
        this.log('info', `${demo ? '[DEMO] ' : ''}Placing ${(setup.direction || '').toUpperCase()} on ${setup.symbol} | score=${setup.score}`);

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
                this.log('error', `Qty too small (${qty}, min=${minQty}) for ${setup.symbol}. Skipping.`);
                return;
            }

            if (!demo) {
                // Set leverage
                try {
                    await bybitReq(creds, 'POST', '/v5/position/set-leverage', {}, {
                        category: 'linear', symbol: setup.symbol, buyLeverage: '10', sellLeverage: '10',
                    });
                } catch {}

                const side = (setup.direction || '').toLowerCase() === 'long' ? 'Buy' : 'Sell';
                const tp   = setup.tp1 || setup.tp;
                const r    = await bybitReq(creds, 'POST', '/v5/order/create', {}, {
                    category: 'linear', symbol: setup.symbol, side,
                    orderType: 'Market', qty: qty.toString(), timeInForce: 'IOC',
                    stopLoss: setup.sl.toString(), takeProfit: tp.toString(),
                    slTriggerBy: 'MarkPrice', tpTriggerBy: 'MarkPrice',
                });

                if (r.retCode !== 0) {
                    this.log('error', `Order rejected: ${r.retMsg}`);
                    return;
                }
            } else {
                this.log('info', `[DEMO] Simulated ${(setup.direction || '').toUpperCase()} ${qty} ${setup.symbol} @ ${setup.entry}`);
            }

            const tp = setup.tp1 || setup.tp;
            const tradeDoc = await AgentTrade.create({
                userId: this.userId, sessionId: this.sessionId,
                symbol: setup.symbol, side: setup.direction,
                entryPrice: setup.entry, sl: setup.sl, tp,
                aiScore: setup.score, aiConfidence: setup.confidence, aiReasoning: setup.reasoning,
                openedAt: new Date().toISOString(),
            });

            this.currentTrade = tradeDoc;
            this.tradesTaken++;
            this.status = 'in_trade';
            await dbSaveState(this.userId, { status: 'in_trade', tradesTaken: this.tradesTaken });
            await AgentSession.findByIdAndUpdate(this.sessionId, { $set: { tradesTaken: this.tradesTaken } });

            emit(this.userId, 'agent:trade_placed', {
                symbol: setup.symbol, direction: setup.direction,
                entry: setup.entry, sl: setup.sl, tp, score: setup.score, qty, demo,
            });
            this.log('success', `Trade placed — ${setup.symbol} ${(setup.direction || '').toUpperCase()} — score: ${setup.score} — entry: ${setup.entry} SL: ${setup.sl} TP: ${tp}`);

            discordNotifier.sendAgentAlert(this.userId, 'trade_placed', {
                symbol: setup.symbol, direction: setup.direction,
                score: setup.score, entry: setup.entry,
                sl: setup.sl, tp, qty, reasoning: setup.reasoning,
            }).catch(() => {});

            // Stop poll loop and monitor the open position
            if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
            this._startMonitor();

        } catch (e) {
            this.log('error', `Trade execution failed: ${e.message}`);
        }
    }

    _startMonitor() {
        if (this._monitorTimer) clearInterval(this._monitorTimer);
        this._monitorTimer = setInterval(() => this._checkPosition(), 30000);
    }

    async _checkPosition() {
        if (!this.running || !this.currentTrade) return;
        try {
            const creds = await getCreds(this.userId);
            if (!creds) return;

            if (this.settings.demoMode) {
                // Demo mode: emit live status updates but no real position to check
                emit(this.userId, 'agent:status_update', this._statusObj());
                return;
            }

            const pos = await getOpenPosition(creds, this.currentTrade.symbol);
            if (!pos) {
                await this._handleTradeClosed(creds);
                return;
            }

            // Per-trade max loss guardrail
            const balance    = await getBalance(creds);
            const maxLossAmt = -(balance * (this.settings.maxLossPerTradePct || 1) / 100);
            if (pos.unrealisedPnl < maxLossAmt) {
                this.log('warn', `Max loss hit on ${this.currentTrade.symbol} (${pos.unrealisedPnl.toFixed(2)} USDT). Force closing.`);
                await this._forceClose(creds, pos);
                return;
            }

            // Time-in-loss guardrail (>20 candles in loss)
            const elapsedMin = (Date.now() - new Date(this.currentTrade.openedAt).getTime()) / 60000;
            const tfMins     = (TF_MS[this.settings.timeframe || '15m'] || 900000) / 60000;
            if (elapsedMin > tfMins * 20 && pos.unrealisedPnl < 0) {
                this.log('warn', `${this.currentTrade.symbol} in loss >20 candles. Force closing.`);
                await this._forceClose(creds, pos);
                return;
            }

            emit(this.userId, 'agent:status_update', { ...this._statusObj(), livePnl: pos.unrealisedPnl });
        } catch (e) {
            this.log('warn', `Monitor error: ${e.message}`);
        }
    }

    async _forceClose(creds, pos) {
        try {
            const cs = pos.side === 'Buy' ? 'Sell' : 'Buy';
            await bybitReq(creds, 'POST', '/v5/order/create', {}, {
                category: 'linear', symbol: pos.symbol, side: cs,
                orderType: 'Market', qty: pos.size.toString(), timeInForce: 'IOC', reduceOnly: true,
            });
            this.log('info', `Force close submitted for ${pos.symbol}`);
            setTimeout(() => this._handleTradeClosed(creds), 3000);
        } catch (e) {
            this.log('error', `Force close failed: ${e.message}`);
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
                pnl        = parseFloat(closed.closedPnl)    || 0;
                closePrice = parseFloat(closed.avgExitPrice) || trade.entryPrice;
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

        const isTP  = closePrice >= (trade.tp || 0) && isWin;
        const event = isTP ? 'tp_hit' : 'sl_hit';
        const result = { symbol: trade.symbol, direction: trade.side, entryPrice: trade.entryPrice, closePrice, pnl, pnlPercent: pnlPct, aiScore: trade.aiScore };

        emit(this.userId, 'agent:trade_closed', result);
        this.log(isWin ? 'success' : 'error',
            `${trade.symbol} ${isTP ? 'TP' : 'SL'} hit — PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`);

        if (this.settings.notifyOnTradeClosed !== false) {
            notifier.notifyTradeClosed(result, this.tradesTaken, this.settings.maxTrades || 3).catch(() => {});
        }
        discordNotifier.sendAgentAlert(this.userId, event, {
            symbol: trade.symbol, direction: trade.side, aiScore: trade.aiScore,
            entryPrice: trade.entryPrice, closePrice, pnl, pnlPercent: pnlPct,
        }).catch(() => {});

        const maxTrades = this.settings.maxTrades || 3;
        if (this.tradesTaken >= maxTrades) { await this.stop('max_trades_reached'); return; }

        // Resume candle-close polling
        this.status = 'scanning';
        this._startPoller();
    }

    _statusObj() {
        return {
            running: this.running, status: this.status,
            tradesTaken: this.tradesTaken, maxTrades: this.settings.maxTrades || 3,
            wins: this.wins, losses: this.losses, totalPnl: this.totalPnl,
            startBalance: this.startBalance, consecutiveLosses: this.consecutiveLosses,
            pstTime: pstTimeStr(), sessionId: this.sessionId,
            timeframe: this.settings.timeframe || '15m',
            demoMode: !!this.settings.demoMode,
            lastScan: this._lastScanAt,
            currentTrade: this.currentTrade ? {
                symbol: this.currentTrade.symbol, direction: this.currentTrade.side,
                entry: this.currentTrade.entryPrice, sl: this.currentTrade.sl, tp: this.currentTrade.tp,
                score: this.currentTrade.aiScore, openedAt: this.currentTrade.openedAt,
            } : null,
        };
    }

    getStatus() { return this._statusObj(); }
}

// ── Public API ────────────────────────────────────────────────

async function startAgent(userId) {
    if (agents.has(userId)) return { ok: false, error: 'Agent already running' };
    const agent = new DayAgent(userId);
    agents.set(userId, agent);
    const result = await agent.start();
    if (!result.ok) agents.delete(userId);
    return result;
}

async function stopAgent(userId, reason = 'manual') {
    const agent = agents.get(userId);
    if (!agent) return { ok: false, error: 'No agent running' };
    await agent.stop(reason);
    return { ok: true };
}

function getStatus(userId) {
    const agent = agents.get(userId);
    if (!agent) return { running: false, status: 'idle', pstTime: pstTimeStr() };
    return agent.getStatus();
}

async function resumeOnBoot() {
    try {
        const states = await AgentState.find({ running: true }).lean();
        for (const state of states) {
            if (!state?.userId) continue;
            if (state.date !== todayPST()) continue;
            const settings = await AgentSettings.findOne({ userId: state.userId }).lean() || {};
            const nowMins  = pstMinutes();
            const endMins  = timeToMins(settings.endTime || '18:00');
            if (nowMins >= endMins) continue;
            console.log(`[Agent] Resuming session for user ${state.userId}…`);
            await startAgent(state.userId);
        }
    } catch (e) {
        console.error('[Agent] Resume error:', e.message);
    }
}

module.exports = { startAgent, stopAgent, getStatus, setIO, resumeOnBoot };
