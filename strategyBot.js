'use strict';

const https    = require('https');
const crypto   = require('crypto');
const { Strategy, BotTrade, BybitStore } = require('./models');
const notifier = require('./notifier');

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
function bybitSign(params, secret) {
    const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
    return crypto.createHmac('sha256', secret).update(sorted).digest('hex');
}

function bybitRequest(apiKey, apiSecret, env, method, endpoint, params = {}) {
    return new Promise((resolve, reject) => {
        const base = env === 'mainnet' ? 'api.bybit.com' : 'api-testnet.bybit.com';
        const ts   = Date.now().toString();
        const recvWindow = '5000';
        let path, bodyStr = '';

        if (method === 'GET') {
            const allParams = { ...params, api_key: apiKey, timestamp: ts, recv_window: recvWindow };
            allParams.sign = bybitSign(allParams, apiSecret);
            const qs = new URLSearchParams(allParams).toString();
            path = `${endpoint}?${qs}`;
        } else {
            const allParams = { ...params, api_key: apiKey, timestamp: ts, recv_window: recvWindow };
            allParams.sign = bybitSign(allParams, apiSecret);
            bodyStr = JSON.stringify(allParams);
            path = endpoint;
        }

        const options = {
            hostname: base, port: 443, path,
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-BAPI-API-KEY': apiKey,
                'X-BAPI-TIMESTAMP': ts,
                'X-BAPI-RECV-WINDOW': recvWindow,
            },
        };
        const req = https.request(options, res => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
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
                try {
                    const j = JSON.parse(data);
                    const candles = (j.result?.list || []).reverse().map(c => ({
                        time: +c[0], open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +c[5],
                    }));
                    resolve(candles);
                } catch (e) { reject(e); }
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

    // First pass: compute point-offset values directly
    if (slBlock && slBlock.params.type === 'points') {
        slDist = +(slBlock.params.value ?? 0.5);
    }
    if (tpBlock && tpBlock.params.type === 'points') {
        tpDist = +(tpBlock.params.value ?? 1.0);
    }

    // Second pass: compute RR-based values using already-known distance
    if (slBlock && slBlock.params.type === 'rr' && tpDist != null) {
        slDist = tpDist / +(slBlock.params.value ?? 2);
    }
    if (tpBlock && tpBlock.params.type === 'rr' && slDist != null) {
        tpDist = slDist * +(tpBlock.params.value ?? 2);
    }

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

// ── Scan cycle ───────────────────────────────────────────────
async function runScanCycle(userId) {
    const bot = bots.get(userId);
    if (!bot || bot.status === 'stopped') return;

    try {
        const strategy = await Strategy.findById(bot.strategyId).lean();
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

        const store = await BybitStore.findOne({ userId }).lean();
        const alertOnly = !store?.apiKey;

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

                    if (isAlertOnly) {
                        try {
                            await notifier.sendAlert(userId, `🔔 STRATEGY ALERT — ${sym}\nStrategy: ${strategy.name}\nSignal: ${dir}\nBlock: ${ifBlock.type}\nPrice: ${ind.price}\n${new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' })} PKT`);
                        } catch (_) {}
                        matched = true;
                        break;
                    }

                    // Guardrail: daily drawdown check
                    const closedToday = await BotTrade.find({ userId, openedAt: { $gte: dayStart }, status: 'closed' }).lean();
                    const totalLoss   = closedToday.reduce((s, t) => s + (t.pnl < 0 ? t.pnl : 0), 0);
                    if (totalLoss < -50) {
                        addLog(userId, 'warn', 'Daily drawdown limit reached — bot stopping');
                        await stopBot(userId);
                        return;
                    }

                    // Place order
                    try {
                        const { orderId, sl, tp, qty } = await placeOrder(userId, sym, side, ind.price, ind.atr, actions, store);
                        await BotTrade.create({
                            userId, strategyId: bot.strategyId, symbol: sym, side: dir,
                            entryPrice: ind.price, sl, tp, quantity: qty, status: 'open',
                            conditionsMet: { conditions: conds },
                        });
                        addLog(userId, 'trade', `Order placed ${sym} ${dir} @ ${ind.price} — orderId: ${orderId}`);
                        emit(userId, 'strategy:order_placed', { symbol: sym, side: dir, entry: ind.price, sl, tp });
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
    try {
        const strategy = await Strategy.findById(bot.strategyId).lean();
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

async function startBot(userId, strategyId) {
    await stopBot(userId);

    await Strategy.updateMany({ userId }, { isActive: false });
    await Strategy.findByIdAndUpdate(strategyId, { isActive: true });

    const strategy = await Strategy.findById(strategyId).lean();

    const bot = {
        strategyId, status: 'idle', lastScan: null, lastCandleTs: null,
        timerId: setInterval(() => pollCandle(userId), 30000),
    };
    bots.set(userId, bot);
    addLog(userId, 'info', `Bot started — strategy: ${strategy?.name} — continuous candle monitoring`);

    // Run immediately on first candle check
    pollCandle(userId);
    return { ok: true };
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

module.exports = { setIO, startBot, stopBot, getStatus, getLogs, resumeActiveBots };
