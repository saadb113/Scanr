'use strict';

const https    = require('https');
const crypto   = require('crypto');
const { Strategy, BotTrade, BybitStore } = require('./models');
const { Settings }                        = require('./models');
const notifier                            = require('./notifier');
const { sendStrategyBotAlert }            = require('./discordNotifier');

// ── Shared indicator utilities (reused from coinScanner) ─────
function calcEMASeries(values, period) {
    if (values.length < period) return values.map(() => null);
    const k = 2 / (period + 1);
    const out = new Array(values.length).fill(null);
    let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    out[period - 1] = ema;
    for (let i = period; i < values.length; i++) {
        ema = values[i] * k + ema * (1 - k);
        out[i] = ema;
    }
    return out;
}

function calcSMASeries(values, period) {
    if (values.length < period) return values.map(() => null);
    const out = new Array(values.length).fill(null);
    let sum = values.slice(0, period).reduce((a, b) => a + b, 0);
    out[period - 1] = sum / period;
    for (let i = period; i < values.length; i++) {
        sum += values[i] - values[i - period];
        out[i] = sum / period;
    }
    return out;
}

function calcRSI(closes, period = 14) {
    if (closes.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const d = closes[i] - closes[i - 1];
        d > 0 ? (gains += d) : (losses -= d);
    }
    let avgG = gains / period, avgL = losses / period;
    for (let i = period + 1; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1];
        avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
        avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
    }
    return avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
}

function calcMACD(closes) {
    const ema12 = calcEMASeries(closes, 12);
    const ema26 = calcEMASeries(closes, 26);
    const macdLine = ema12.map((v, i) => (v != null && ema26[i] != null) ? v - ema26[i] : null);
    const valid = macdLine.filter(v => v != null);
    const signalSeries = calcEMASeries(valid, 9);
    const macd   = macdLine[macdLine.length - 1] ?? 0;
    const signal = signalSeries[signalSeries.length - 1] ?? 0;
    const macdPrev = macdLine[macdLine.length - 2] ?? 0;
    const validPrev = valid[valid.length - 2] ?? 0;
    const signalSeriesPrev = signalSeries[signalSeries.length - 2] ?? 0;
    return { macd, signal, hist: macd - signal, macdPrev, histPrev: macdPrev - signalSeriesPrev };
}

function calcATR(candles, period = 14) {
    if (candles.length < 2) return 0;
    const trs = candles.slice(1).map((c, i) => {
        const prev = candles[i];
        return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
    });
    return trs.slice(-period).reduce((a, b) => a + b, 0) / Math.min(period, trs.length);
}

function calcStochastic(candles, kPeriod = 14, dPeriod = 3) {
    if (candles.length < kPeriod) return { k: 50, d: 50, prevK: 50, prevD: 50 };
    const kValues = [];
    for (let i = kPeriod - 1; i < candles.length; i++) {
        const slice   = candles.slice(i - kPeriod + 1, i + 1);
        const lowest  = Math.min(...slice.map(c => c.low));
        const highest = Math.max(...slice.map(c => c.high));
        const k = highest === lowest ? 50 : ((candles[i].close - lowest) / (highest - lowest)) * 100;
        kValues.push(k);
    }
    const dSeries = calcSMASeries(kValues, dPeriod);
    const k     = kValues[kValues.length - 1];
    const d     = dSeries[dSeries.length - 1] ?? 50;
    const prevK = kValues.length >= 2 ? kValues[kValues.length - 2] : k;
    const prevD = dSeries.length >= 2 ? (dSeries[dSeries.length - 2] ?? 50) : d;
    return { k, d, prevK, prevD };
}

function getTrend(candles) {
    if (candles.length < 26) return 'neutral';
    const closes = candles.map(c => c.close);
    const ema12s = calcEMASeries(closes, 12);
    const ema26s = calcEMASeries(closes, 26);
    const last = closes.length - 1;
    const e12 = ema12s[last], e26 = ema26s[last];
    if (e12 == null || e26 == null) return 'neutral';
    const diff = (e12 - e26) / e26;
    if (diff > 0.002) return 'bullish';
    if (diff < -0.002) return 'bearish';
    return 'neutral';
}

// ── Bybit API (server-side) ──────────────────────────────────
function bybitRequest(apiKey, apiSecret, env, method, endpoint, params = {}) {
    return new Promise((resolve, reject) => {
        const hostname = env === 'mainnet' ? 'api.bybit.com' : 'api-demo.bybit.com';
        const ts         = Date.now().toString();
        const recvWindow = '5000';
        let path, bodyStr = '';

        if (method === 'GET') {
            const qs = new URLSearchParams(params).toString();
            const signStr = ts + apiKey + recvWindow + qs;
            const sign = crypto.createHmac('sha256', apiSecret).update(signStr).digest('hex');
            path = `${endpoint}${qs ? '?' + qs : ''}`;
            const options = {
                hostname, port: 443, path, method,
                headers: {
                    'X-BAPI-API-KEY': apiKey, 'X-BAPI-SIGN': sign,
                    'X-BAPI-TIMESTAMP': ts, 'X-BAPI-RECV-WINDOW': recvWindow,
                },
            };
            const req = https.request(options, res => {
                let data = '';
                res.on('data', d => data += d);
                res.on('end', () => {
                    if (data.trimStart().startsWith('<')) return reject(new Error(`Bybit returned HTML (HTTP ${res.statusCode}) — possible rate limit or block`));
                    try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`Bybit parse error: ${data.slice(0, 80)}`)); }
                });
            });
            req.on('error', reject);
            req.end();
        } else {
            bodyStr = JSON.stringify(params);
            const signStr = ts + apiKey + recvWindow + bodyStr;
            const sign = crypto.createHmac('sha256', apiSecret).update(signStr).digest('hex');
            path = endpoint;
            const options = {
                hostname, port: 443, path, method,
                headers: {
                    'Content-Type': 'application/json',
                    'X-BAPI-API-KEY': apiKey, 'X-BAPI-SIGN': sign,
                    'X-BAPI-SIGN-TYPE': '2', 'X-BAPI-TIMESTAMP': ts,
                    'X-BAPI-RECV-WINDOW': recvWindow,
                },
            };
            const req = https.request(options, res => {
                let data = '';
                res.on('data', d => data += d);
                res.on('end', () => {
                    if (data.trimStart().startsWith('<')) return reject(new Error(`Bybit returned HTML (HTTP ${res.statusCode}) — possible rate limit or block`));
                    try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`Bybit parse error: ${data.slice(0, 80)}`)); }
                });
            });
            req.on('error', reject);
            req.write(bodyStr);
            req.end();
        }
    });
}

function fetchBybitKlines(symbol, interval, limit = 100) {
    return new Promise((resolve, reject) => {
        const params = new URLSearchParams({ category: 'linear', symbol, interval, limit: String(limit) });
        const options = {
            hostname: 'api.bybit.com', port: 443,
            path: `/v5/market/kline?${params}`, method: 'GET',
        };
        const req = https.request(options, res => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => {
                if (data.trimStart().startsWith('<')) return reject(new Error(`Bybit kline returned HTML (HTTP ${res.statusCode}) — possible rate limit or block`));
                try {
                    const j = JSON.parse(data);
                    const candles = (j.result?.list || []).reverse().map(c => ({
                        time: +c[0], open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +c[5],
                    }));
                    resolve(candles);
                } catch (e) { reject(new Error(`Bybit kline parse error: ${data.slice(0, 80)}`)); }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

// ── Condition Evaluator ──────────────────────────────────────
function compareValue(val, op, threshold) {
    if (val == null) return false;
    switch (op) {
        case '<':  return val < threshold;
        case '>':  return val > threshold;
        case '<=': return val <= threshold;
        case '>=': return val >= threshold;
        case '=':  return Math.abs(val - threshold) < threshold * 0.005;
        default:   return false;
    }
}

function evaluateBlock(block, ind) {
    switch (block.type) {
        case 'RSI':
            return compareValue(ind.rsi, block.params.condition || '<', +(block.params.value ?? 30));
        case 'RSI_CROSS': {
            const lvl = +(block.params.level ?? 50);
            const dir = block.params.direction || 'cross_above';
            if (dir === 'cross_above') return ind.prevRsi < lvl && ind.rsi >= lvl;
            if (dir === 'cross_below') return ind.prevRsi > lvl && ind.rsi <= lvl;
            return false;
        }
        case 'MACD_CROSS':
            return block.params.direction === 'bullish'
                ? ind.macd.hist > 0 && ind.macd.histPrev <= 0
                : ind.macd.hist < 0 && ind.macd.histPrev >= 0;
        case 'MACD_HIST':
            return block.params.direction === 'above' ? ind.macd.hist > 0 : ind.macd.hist < 0;
        case 'EMA_CROSS':
        case 'MA_CROSS': {
            const fp     = +(block.params.fastPeriod ?? 12);
            const sp     = +(block.params.slowPeriod ?? 26);
            const maType = block.params.maType || 'EMA';
            const lookup = maType === 'SMA' ? ind.smas : ind.emas;
            const fast   = lookup[fp], slow = lookup[sp];
            if (fast == null || slow == null) return false;
            return block.params.direction === 'above' ? fast > slow : fast < slow;
        }
        case 'PRICE_EMA':
        case 'PRICE_MA': {
            const p      = +(block.params.period ?? 200);
            const maType = block.params.maType || 'EMA';
            const lookup = maType === 'SMA' ? ind.smas : ind.emas;
            const ma     = lookup[p];
            if (ma == null) return false;
            return block.params.direction === 'above' ? ind.price > ma : ind.price < ma;
        }
        case 'STOCHASTIC': {
            const cond = block.params.condition || 'k_below';
            const val  = +(block.params.value ?? 20);
            const { k, d, prevK, prevD } = ind.stoch;
            switch (cond) {
                case 'k_cross_above_d': return prevK < prevD && k >= d;
                case 'k_cross_below_d': return prevK > prevD && k <= d;
                case 'k_below':         return k < val;
                case 'k_above':         return k > val;
                case 'kd_both_below':   return k < val && d < val;
                case 'kd_both_above':   return k > val && d > val;
                default:                return false;
            }
        }
        case 'VOLUME_SPIKE':
            return ind.volumeRatio >= +(block.params.multiplier ?? 2);
        case 'ATR':
            return compareValue(ind.atr, block.params.condition || '>', +(block.params.value ?? 0));
        case 'TREND_4H':
            return ind.trend4h === (block.params.direction || 'bullish');
        case 'TREND_1H':
            return ind.trend1h === (block.params.direction || 'bullish');
        case 'TREND_ALIGN':
            return ind.trend4h === ind.trend1h && ind.trend4h !== 'neutral';
        case 'TRADING_HOURS': {
            const pkt = new Date(Date.now() + 5 * 3600000);
            const hr  = pkt.getUTCHours() + pkt.getUTCMinutes() / 60;
            return hr >= +(block.params.startHour ?? 8) && hr <= +(block.params.endHour ?? 18);
        }
        case 'DAY_OF_WEEK': {
            const days = block.params.days || [1, 2, 3, 4, 5];
            const pkt  = new Date(Date.now() + 5 * 3600000);
            return days.includes(pkt.getUTCDay());
        }
        default:
            return true;
    }
}

function evaluateFilterBlocks(blocks, ind) {
    for (const b of blocks) {
        if (!evaluateBlock(b, ind)) return false;
    }
    return true;
}

function evaluateConditionBlocks(blocks, ind) {
    if (!blocks.length) return false;
    let result = evaluateBlock(blocks[0], ind);
    for (let i = 1; i < blocks.length; i++) {
        const val = evaluateBlock(blocks[i], ind);
        result = blocks[i].operator === 'OR' ? result || val : result && val;
    }
    return result;
}

// ── Per-coin indicators ──────────────────────────────────────
async function calcIndicators(symbol, emaPeriods, smaPeriods) {
    const [c5m, c1h, c4h] = await Promise.all([
        fetchBybitKlines(symbol, '5', 200),
        fetchBybitKlines(symbol, '60', 60),
        fetchBybitKlines(symbol, '240', 60),
    ]);

    const closes5m = c5m.map(c => c.close);
    const rsi      = calcRSI(closes5m);
    const prevRsi  = calcRSI(closes5m.slice(0, -1));
    const macd     = calcMACD(closes5m);
    const atr      = calcATR(c5m);
    const price    = closes5m[closes5m.length - 1] ?? 0;
    const stoch    = calcStochastic(c5m);

    const volumes = c5m.slice(-20).map(c => c.volume);
    const avgVol  = volumes.slice(0, -1).reduce((a, b) => a + b, 0) / (volumes.length - 1);
    const volumeRatio = avgVol > 0 ? volumes[volumes.length - 1] / avgVol : 0;

    const emas = {};
    for (const p of emaPeriods) {
        const ser = calcEMASeries(closes5m, p);
        emas[p] = ser[ser.length - 1];
    }
    const smas = {};
    for (const p of smaPeriods) {
        const ser = calcSMASeries(closes5m, p);
        smas[p] = ser[ser.length - 1];
    }

    return {
        price, rsi, prevRsi, macd, atr, volumeRatio, emas, smas, stoch,
        trend4h: getTrend(c4h),
        trend1h: getTrend(c1h),
    };
}

function getNeededPeriods(allBlocks) {
    const emaPeriods = new Set();
    const smaPeriods = new Set();
    for (const b of allBlocks) {
        if (b.type === 'EMA_CROSS' || b.type === 'MA_CROSS') {
            const maType = b.params.maType || 'EMA';
            const fp = +(b.params.fastPeriod ?? 12);
            const sp = +(b.params.slowPeriod ?? 26);
            if (maType === 'SMA') { smaPeriods.add(fp); smaPeriods.add(sp); }
            else { emaPeriods.add(fp); emaPeriods.add(sp); }
        }
        if (b.type === 'PRICE_EMA' || b.type === 'PRICE_MA') {
            const maType = b.params.maType || 'EMA';
            const p = +(b.params.period ?? 200);
            if (maType === 'SMA') smaPeriods.add(p);
            else emaPeriods.add(p);
        }
    }
    return { emaPeriods: [...emaPeriods], smaPeriods: [...smaPeriods] };
}

function getSLBlock(actions) { return actions.find(b => b.type === 'STOP_LOSS'); }
function getTPBlock(actions) { return actions.find(b => b.type === 'TAKE_PROFIT'); }
function getSizeBlock(actions) { return actions.find(b => b.type === 'POSITION_SIZE'); }

async function getBybitPositions(store) {
    if (!store?.apiKey) return [];
    try {
        const res = await bybitRequest(
            store.apiKey, store.apiSecret, store.env,
            'GET', '/v5/position/list', { category: 'linear', settleCoin: 'USDT' }
        );
        return (res?.result?.list || []).filter(p => +p.size > 0);
    } catch (_) { return []; }
}

// ── Order placement ──────────────────────────────────────────
async function placeOrder(userId, symbol, side, price, atr, actions, store) {
    const slBlock   = getSLBlock(actions);
    const tpBlock   = getTPBlock(actions);
    const sizeBlock = getSizeBlock(actions);

    // Two-pass SL/TP calculation to handle RR dependencies
    let slDist = null, tpDist = null;

    // First pass: point-offset values
    if (slBlock && slBlock.params.type === 'points') slDist = +(slBlock.params.value ?? 0.5);
    if (tpBlock && tpBlock.params.type === 'points') tpDist = +(tpBlock.params.value ?? 1.0);

    // Second pass: RR-based using already-known distance
    if (slBlock && slBlock.params.type === 'rr' && tpDist != null) slDist = tpDist / +(slBlock.params.value ?? 2);
    if (tpBlock && tpBlock.params.type === 'rr' && slDist != null) tpDist = slDist * +(tpBlock.params.value ?? 2);

    // Third pass: break circular RR (both set to rr with no anchor) — use ATR as base
    if (slBlock && slDist == null && atr > 0) slDist = atr;
    if (tpBlock && tpDist == null && slDist != null && tpBlock.params.type === 'rr') tpDist = slDist * +(tpBlock.params.value ?? 2);
    if (slBlock && slDist == null && tpDist != null && slBlock.params.type === 'rr') slDist = tpDist / +(slBlock.params.value ?? 2);

    const sl = slDist != null ? (side === 'Buy' ? price - slDist : price + slDist) : null;
    const tp = tpDist != null ? (side === 'Buy' ? price + tpDist : price - tpDist) : null;

    // Calculate quantity (use 1% of capital default)
    let qty = 0.01;
    if (sizeBlock) {
        const t = sizeBlock.params.type || '%';
        const v = +(sizeBlock.params.value ?? 1);
        if (t === 'USDT') {
            qty = parseFloat((v / price).toFixed(3));
        } else {
            // % of capital — fetch balance
            try {
                const balRes = await bybitRequest(
                    store.apiKey, store.apiSecret, store.env,
                    'GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' }
                );
                const bal = +balRes?.result?.list?.[0]?.totalAvailableBalance ?? 100;
                qty = parseFloat(((bal * v / 100) / price).toFixed(3));
            } catch (_) { qty = 0.01; }
        }
    }

    const orderParams = {
        category: 'linear', symbol, side, orderType: 'Market',
        qty: String(qty), timeInForce: 'GTC',
    };
    if (sl) orderParams.stopLoss = String(parseFloat(sl.toFixed(4)));
    if (tp) orderParams.takeProfit = String(parseFloat(tp.toFixed(4)));

    const res = await bybitRequest(store.apiKey, store.apiSecret, store.env, 'POST', '/v5/order/create', orderParams);
    if (res.retCode !== 0) throw new Error(res.retMsg);

    return { orderId: res.result?.orderId, sl, tp, qty };
}

// ── Bot state registry ───────────────────────────────────────
const bots   = new Map(); // userId → { timerId, status, strategyId, ... }
const botLogs = new Map(); // userId → string[]
let _io = null;

function setIO(io) { _io = io; }

function addLog(userId, level, message) {
    const logs = botLogs.get(userId) || [];
    logs.unshift({ level, message, ts: Date.now() });
    if (logs.length > 100) logs.pop();
    botLogs.set(userId, logs);
    if (_io) _io.to(userId).emit('strategy:log', { level, message, timestamp: Date.now() });
}

function emit(userId, event, data) {
    if (_io) _io.to(userId).emit(event, data);
}

// ── Discord helpers ──────────────────────────────────────────
async function getStrategyBotWebhook(userId) {
    try {
        const settings = await Settings.findOne({ userId }).lean();
        const discord  = settings?.discord;
        if (!discord?.webhookUrl) return null;
        if (discord?.alerts?.strategyBotAlerts === false) return null;
        return discord.webhookUrl;
    } catch (_) { return null; }
}

async function checkClosedTrades(userId, store, strategyId) {
    if (!store) return;
    const openTrades = await BotTrade.find({ userId, strategyId, status: 'open' }).lean().catch(() => []);
    if (!openTrades.length) return;
    const bybitPositions = await getBybitPositions(store).catch(() => []);
    const openSymbols    = new Set(bybitPositions.map(p => p.symbol));

    const webhook     = await getStrategyBotWebhook(userId);
    const strategyDoc = await Strategy.findById(strategyId).lean().catch(() => null);

    for (const trade of openTrades) {
        if (openSymbols.has(trade.symbol)) continue; // still open on Bybit

        let exitPrice = trade.entryPrice;
        try {
            const pr = await bybitRequest(store.apiKey, store.apiSecret, store.env,
                'GET', '/v5/market/tickers', { category: 'linear', symbol: trade.symbol });
            exitPrice = parseFloat(pr?.result?.list?.[0]?.lastPrice) || trade.entryPrice;
        } catch (_) {}

        // Determine if TP or SL hit
        let closeType = 'tp_hit';
        if (trade.sl != null && trade.tp != null) {
            closeType = Math.abs(exitPrice - trade.sl) <= Math.abs(exitPrice - trade.tp) ? 'sl_hit' : 'tp_hit';
        } else if (trade.sl != null) {
            const isLong = trade.side === 'LONG';
            closeType = (isLong ? exitPrice <= trade.sl : exitPrice >= trade.sl) ? 'sl_hit' : 'tp_hit';
        }

        const pnl    = (exitPrice - trade.entryPrice) * (trade.quantity || 0.01) * (trade.side === 'LONG' ? 1 : -1);
        const pnlPct = trade.entryPrice ? pnl / (trade.entryPrice * (trade.quantity || 0.01)) * 100 : null;

        await BotTrade.findByIdAndUpdate(trade._id, { status: 'closed', exitPrice, closedAt: new Date(), pnl }).catch(() => {});
        addLog(userId, 'trade', `${trade.symbol} ${closeType === 'tp_hit' ? 'TP' : 'SL'} hit @ ${exitPrice} | PnL: ${pnl.toFixed(4)} USDT`);
        emit(userId, 'strategy:trade_closed', { symbol: trade.symbol, type: closeType, pnl, exitPrice });

        if (webhook) {
            sendStrategyBotAlert(webhook, closeType, {
                symbol: trade.symbol, direction: trade.side,
                entryPrice: trade.entryPrice, exitPrice,
                pnl, pnlPct, strategyName: strategyDoc?.name,
            }).catch(() => {});
        }
    }
}

// ── Scan cycle ───────────────────────────────────────────────
async function runScanCycle(userId) {
    const bot = bots.get(userId);
    if (!bot || bot.status === 'stopped') return;

    try {
        const strategy = await Strategy.findById(bot.strategyId).lean();
        // Bug 1+2: bail if startBot replaced this bot while we were awaiting
        if (bots.get(userId) !== bot) return;
        if (!strategy || !strategy.isActive) { await stopBot(userId); return; }

        const blocks  = strategy.blocks || { filters: [], ifBlocks: [], exitConditions: [] };
        const coins   = strategy.coins?.length ? strategy.coins : ['BTCUSDT', 'ETHUSDT'];
        const maxTPD  = strategy.maxTradesPerDay || 3;

        // Guardrail: max trades per day
        const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
        const tradesToday = await BotTrade.countDocuments({
            userId, strategyId: bot.strategyId, openedAt: { $gte: dayStart },
        });
        if (tradesToday >= maxTPD) {
            addLog(userId, 'warn', `Max trades/day (${maxTPD}) reached — skipping scan`);
            return;
        }

        const rawStore = await BybitStore.findOne({ userId }).lean();
        const _env  = rawStore?.activeEnv || 'mainnet';
        const _cred = rawStore?.[_env] || {};
        const store = (_cred.apiKey && _cred.apiSecret)
            ? { apiKey: _cred.apiKey, apiSecret: _cred.apiSecret, env: _env }
            : null;
        const alertOnly = !store;
        if (alertOnly) addLog(userId, 'info', 'No Bybit API credentials — running in alert-only mode');

        // Check if any open BotTrades were closed on Bybit (TP/SL hit)
        await checkClosedTrades(userId, store, bot.strategyId);

        bot.status = 'scanning';
        bot.lastScan = Date.now();
        emit(userId, 'strategy:scan_started', { total: coins.length });

        // Normalise blocks: support old format (conditions/actions) and new (ifBlocks)
        const filters = blocks.filters || [];
        let ifBlocks = blocks.ifBlocks;
        if (!ifBlocks) {
            // Migrate old format
            ifBlocks = [{ type: 'if', conditions: blocks.conditions || [], actions: blocks.actions || [] }];
        }
        const exitConditions = blocks.exitConditions || [];

        // Collect all condition blocks for indicator period detection
        const allCondBlocks = [
            ...filters,
            ...ifBlocks.flatMap(b => b.conditions || []),
            ...exitConditions,
        ];
        const { emaPeriods, smaPeriods } = getNeededPeriods(allCondBlocks);

        // One position at a time: check if any real Bybit position is open
        const openBybitPositions = store ? await getBybitPositions(store) : [];
        const hasOpenPosition = openBybitPositions.length > 0;
        if (hasOpenPosition) {
            addLog(userId, 'info', `Open Bybit position detected — skipping entry scan`);
        }

        let foundSignals = 0;

        for (let i = 0; i < coins.length; i++) {
            const sym = coins[i];
            emit(userId, 'strategy:scan_progress', { scanned: i + 1, total: coins.length, symbol: sym });

            try {
                const ind = await calcIndicators(sym, emaPeriods, smaPeriods);

                // ── Filters ──
                const passFilters = evaluateFilterBlocks(filters, ind);
                if (!passFilters) continue;

                // ── Check open position for exit conditions ──
                const openPos = await BotTrade.findOne({ userId, symbol: sym, status: 'open' });
                if (openPos && exitConditions.length > 0) {
                    const exitMet = evaluateConditionBlocks(exitConditions, ind);
                    if (exitMet) {
                        addLog(userId, 'signal', `${sym} — exit condition met, closing position`);
                        emit(userId, 'strategy:conditions_met', { symbol: sym, side: 'EXIT', conditions: 'exit' });
                        if (!alertOnly) {
                            try {
                                // Place a market close order (opposite side of open position)
                                const closeSide = openPos.side === 'LONG' ? 'Sell' : 'Buy';
                                await placeOrder(userId, sym, closeSide, ind.price, ind.atr, [{ type: 'EXIT_POSITION', params: {} }], store);
                                await BotTrade.updateOne({ _id: openPos._id }, { status: 'closed', closedAt: new Date(), exitPrice: ind.price, pnl: 0 });
                                foundSignals++;
                            } catch (e) {
                                addLog(userId, 'error', `Exit order failed ${sym}: ${e.message}`);
                            }
                        }
                    }
                    continue; // Already in a trade — skip entry logic
                }

                if (openPos) continue; // Has open position but no exit conditions to evaluate

                // Skip entry if any Bybit position is open (one at a time rule)
                if (hasOpenPosition) continue;

                // ── IF / ELSE IF / ELSE evaluation ──
                let matched = false;
                for (const ifBlock of ifBlocks) {
                    let condMet = false;
                    if (ifBlock.type === 'else') {
                        condMet = true; // ELSE always matches if we get here
                    } else {
                        condMet = evaluateConditionBlocks(ifBlock.conditions || [], ind);
                    }

                    if (!condMet) continue;

                    const actions  = ifBlock.actions || [];
                    const dirBlock = actions.find(b => ['ENTER_LONG', 'ENTER_SHORT'].includes(b.type));
                    const isAlertOnly = actions.some(b => b.type === 'ALERT_ONLY') || alertOnly;
                    const conds    = (ifBlock.conditions || []).map(b => b.type).join(', ') || ifBlock.type;
                    const side     = dirBlock?.type === 'ENTER_SHORT' ? 'Sell' : 'Buy';
                    const dir      = side === 'Buy' ? 'LONG' : 'SHORT';

                    addLog(userId, 'signal', `${sym} — ${ifBlock.type.toUpperCase()} block matched (${conds})`);
                    emit(userId, 'strategy:conditions_met', { symbol: sym, side: dir, conditions: conds });
                    addLog(userId, 'info', `${sym} — actions: [${actions.map(a => a.type).join(', ') || 'none'}] | alertOnly=${isAlertOnly} | dirBlock=${dirBlock?.type || 'none'}`);

                    if (isAlertOnly) {
                        addLog(userId, 'info', `${sym} — alert-only: no Bybit credentials, skipping order`);
                        try {
                            await notifier.sendAlert(userId, `🔔 STRATEGY ALERT — ${sym}\nStrategy: ${strategy.name}\nSignal: ${dir}\nBlock: ${ifBlock.type}\nPrice: ${ind.price}\n${new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' })} PKT`);
                        } catch (_) {}
                        matched = true;
                        break;
                    }

                    // Guardrail: daily drawdown check
                    const closedToday = await BotTrade.find({ userId, openedAt: { $gte: dayStart }, status: 'closed' }).lean();
                    const totalLoss   = closedToday.reduce((s, t) => s + (t.pnl < 0 ? t.pnl : 0), 0);
                    addLog(userId, 'info', `${sym} — drawdown check: totalLoss=$${totalLoss.toFixed(2)}, limit=$-50`);
                    if (totalLoss < -50) {
                        addLog(userId, 'warn', 'Daily drawdown limit reached — bot stopping');
                        await stopBot(userId);
                        return;
                    }

                    // Place order
                    addLog(userId, 'info', `${sym} — placing ${dir} order @ ${ind.price} | ATR=${ind.atr?.toFixed(4)}`);
                    try {
                        const { orderId, sl, tp, qty } = await placeOrder(userId, sym, side, ind.price, ind.atr, actions, store);
                        await BotTrade.create({
                            userId, strategyId: bot.strategyId, symbol: sym, side: dir,
                            entryPrice: ind.price, sl, tp, quantity: qty, status: 'open',
                            conditionsMet: { conditions: conds },
                        });
                        addLog(userId, 'trade', `Order placed ${sym} ${dir} @ ${ind.price} — orderId: ${orderId} | SL: ${sl ?? 'none'} | TP: ${tp ?? 'none'} | qty: ${qty}`);
                        emit(userId, 'strategy:order_placed', { symbol: sym, side: dir, entry: ind.price, sl, tp });
                        // Discord notification
                        getStrategyBotWebhook(userId).then(wh => {
                            if (wh) sendStrategyBotAlert(wh, 'trade_placed', {
                                symbol: sym, direction: dir, entryPrice: ind.price,
                                sl, tp, qty, strategyName: strategy.name,
                            }).catch(() => {});
                        }).catch(() => {});
                        foundSignals++;
                    } catch (e) {
                        addLog(userId, 'error', `Order failed ${sym}: ${e.message}`);
                        emit(userId, 'strategy:order_failed', { symbol: sym, error: e.message });
                    }

                    matched = true;
                    break; // Stop after first matching block
                }

            } catch (e) {
                addLog(userId, 'error', `Scan error ${sym}: ${e.message}`);
            }
        }

        bot.status = 'idle';
        emit(userId, 'strategy:scan_complete', { found: foundSignals, duration: ((Date.now() - bot.lastScan) / 1000).toFixed(1) });

    } catch (e) {
        addLog(userId, 'error', `Scan cycle error: ${e.message}`);
        bot.status = 'idle';
    }
}

// ── Public API ───────────────────────────────────────────────
// TF → Bybit interval string
const TF_INTERVAL = { '1m':'1','3m':'3','5m':'5','15m':'15','30m':'30','1h':'60','2h':'120','4h':'240','1d':'D' };

// Continuous candle-close polling (every 30s)
async function pollCandle(userId) {
    const bot = bots.get(userId);
    if (!bot) return;
    if (bot.status === 'scanning') {
        addLog(userId, 'info', 'Poll tick skipped — previous scan still running');
        return;
    }
    try {
        const strategy = await Strategy.findById(bot.strategyId).lean();
        // Bug 1+2: if startBot replaced this bot while we were awaiting, exit quietly
        // instead of calling stopBot() which would kill the new bot.
        if (bots.get(userId) !== bot) return;
        if (!strategy || !strategy.isActive) { await stopBot(userId); return; }

        const tf       = strategy.timeframe || '5m';
        const interval = TF_INTERVAL[tf] || '5';
        const refCoin  = strategy.coins?.[0] || 'BTCUSDT';

        // Fetch latest 2 candles to detect a new closed candle
        const candles = await fetchBybitKlines(refCoin, interval, 2);
        if (!candles.length) return;

        const latestTs = candles[candles.length - 1].time;
        if (!bot.lastCandleTs || latestTs > bot.lastCandleTs) {
            bot.lastCandleTs = latestTs;
            addLog(userId, 'info', `New ${tf} candle detected — scanning`);
            await runScanCycle(userId);
        }
    } catch (e) {
        addLog(userId, 'error', `Candle poll error: ${e.message}`);
    }
}

const starting = new Set(); // guard against concurrent startBot calls

async function startBot(userId, strategyId) {
    if (starting.has(userId)) return { ok: true };
    starting.add(userId);
    try {
        await stopBot(userId);
        await Strategy.findByIdAndUpdate(strategyId, { isActive: true });

        const strategy = await Strategy.findById(strategyId).lean();

        const bot = {
            strategyId, status: 'idle', lastScan: null, lastCandleTs: null,
            timerId: setInterval(() => pollCandle(userId), 30000),
        };
        bots.set(userId, bot);
        addLog(userId, 'info', `Bot started — strategy: "${strategy?.name}" | coins: ${(strategy?.coins || []).join(', ') || 'default'} | if-blocks: ${(strategy?.blocks?.ifBlocks || []).length}`);
        addLog(userId, 'info', `Loaded blocks: ${JSON.stringify(strategy?.blocks)}`);

        // Discord bot start notification
        getStrategyBotWebhook(userId).then(wh => {
            if (wh) sendStrategyBotAlert(wh, 'bot_start', {
                strategyName: strategy?.name,
                timeframe:    strategy?.timeframe || '5m',
                coinCount:    (strategy?.coins || []).length,
            }).catch(() => {});
        }).catch(() => {});

        // Run immediately on first candle check
        pollCandle(userId);
        return { ok: true };
    } finally {
        starting.delete(userId);
    }
}

async function stopBot(userId) {
    const bot = bots.get(userId);
    if (bot) {
        clearInterval(bot.timerId);
        bots.delete(userId);
    }
    await Strategy.updateMany({ userId }, { isActive: false });
    addLog(userId, 'info', 'Bot stopped');
    return { ok: true };
}

function getStatus(userId) {
    const bot = bots.get(userId);
    if (!bot) return { running: false };
    return {
        running: true,
        status: bot.status,
        strategyId: bot.strategyId,
        lastScan: bot.lastScan,
    };
}

function getLogs(userId) {
    return botLogs.get(userId) || [];
}

async function resumeActiveBots() {
    try {
        const active = await Strategy.find({ isActive: true }).lean();
        for (const s of active) {
            addLog(s.userId, 'info', `Resuming bot from restart — strategy: ${s.name}`);
            await startBot(s.userId, String(s._id));
        }
    } catch (e) {
        console.error('[strategyBot] resumeActiveBots error:', e.message);
    }
}

function notifyManualClose(userId, symbol) {
    addLog(userId, 'info', `Position manually closed${symbol ? ` (${symbol})` : ''} — bot resuming scan`);
    const bot = bots.get(userId);
    if (bot && bot.status === 'idle') pollCandle(userId);
}

async function closeTradeManually(userId, tradeId) {
    const trade = await BotTrade.findOne({ _id: tradeId, userId }).lean();
    if (!trade)              throw new Error('Trade not found');
    if (trade.status !== 'open') throw new Error('Trade already closed');

    const rawStore = await BybitStore.findOne({ userId }).lean();
    const _env  = rawStore?.activeEnv || 'mainnet';
    const _cred = rawStore?.[_env] || {};
    const store = (_cred.apiKey && _cred.apiSecret)
        ? { apiKey: _cred.apiKey, apiSecret: _cred.apiSecret, env: _env }
        : null;

    let exitPrice = trade.entryPrice;

    if (store) {
        // Fetch current market price
        try {
            const pr = await bybitRequest(store.apiKey, store.apiSecret, store.env,
                'GET', '/v5/market/tickers', { category: 'linear', symbol: trade.symbol });
            exitPrice = parseFloat(pr?.result?.list?.[0]?.lastPrice) || trade.entryPrice;
        } catch (_) {}

        // Place market close order
        const closeSide = trade.side === 'LONG' ? 'Sell' : 'Buy';
        const closeRes  = await bybitRequest(store.apiKey, store.apiSecret, store.env,
            'POST', '/v5/order/create', {
                category: 'linear', symbol: trade.symbol,
                side: closeSide, orderType: 'Market',
                qty: String(trade.quantity || 0.01),
                timeInForce: 'GTC', reduceOnly: true,
            });
        if (closeRes.retCode !== 0) throw new Error(closeRes.retMsg);
    }

    const pnl = (exitPrice - trade.entryPrice) * (trade.quantity || 0.01) * (trade.side === 'LONG' ? 1 : -1);
    const updated = await BotTrade.findByIdAndUpdate(trade._id,
        { status: 'closed', exitPrice, closedAt: new Date(), pnl },
        { new: true }
    ).lean();

    notifyManualClose(userId, trade.symbol);

    // Discord manual close notification
    const pnlPct = (trade.entryPrice && trade.quantity)
        ? pnl / (trade.entryPrice * trade.quantity) * 100
        : null;
    getStrategyBotWebhook(userId).then(async wh => {
        if (!wh) return;
        const strategyDoc = await Strategy.findById(trade.strategyId).lean().catch(() => null);
        sendStrategyBotAlert(wh, 'manual_close', {
            symbol: trade.symbol, direction: trade.side,
            entryPrice: trade.entryPrice, exitPrice,
            pnl, pnlPct, strategyName: strategyDoc?.name,
        }).catch(() => {});
    }).catch(() => {});

    return updated;
}

module.exports = { setIO, startBot, stopBot, getStatus, getLogs, resumeActiveBots, closeTradeManually };
