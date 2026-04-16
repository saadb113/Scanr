'use strict';

const https    = require('https');
const crypto   = require('crypto');
const { Strategy, BotTrade, BybitStore } = require('./models');
const { Settings, BotLog }               = require('./models');
const notifier                            = require('./notifier');
const { sendStrategyBotAlert }            = require('./discordNotifier');
const { sendStrategyBotAlert: sendTelegramStrategyBotAlert } = {} //;
const {
    calcEMASeries,
    calcSMASeries,
    calcRSI,
    calcMACD,
    calcATR,
    calcStochastic,
    calcVolumeRatio,
    fetchCandles,
} = require('./utils/indicators');

// PKT day start helper (midnight Pakistan Standard Time = UTC+5)
function getPKTDayStart() {
    const pktOffset = 5 * 3600000;
    const pktNow    = new Date(Date.now() + pktOffset);
    return new Date(Date.UTC(
        pktNow.getUTCFullYear(), pktNow.getUTCMonth(), pktNow.getUTCDate()
    ) - pktOffset);
}

// ── Local helpers (not in shared indicators) ─────────────────

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

// ── Candle pattern detection ──────────────────────────────────
function _cp(c) {
    const body  = Math.abs(c.close - c.open);
    const range = (c.high - c.low) || 0.0001;
    return {
        body, range,
        upper: c.high - Math.max(c.open, c.close),
        lower: Math.min(c.open, c.close) - c.low,
        bull:  c.close >= c.open,
    };
}

function detectCandlePattern(candles, pattern) {
    if (candles.length < 3) return false;
    const c  = candles[candles.length - 1];
    const c1 = candles[candles.length - 2];
    const c2 = candles[candles.length - 3];
    const p  = _cp(c), p1 = _cp(c1), p2 = _cp(c2);
    switch (pattern) {
        case 'hammer':
            return p.lower >= p.body * 2 && p.upper <= p.body * 0.5 && p.body > 0;
        case 'shooting_star':
            return p.upper >= p.body * 2 && p.lower <= p.body * 0.5 && p.body > 0;
        case 'doji':
            return p.body <= p.range * 0.1;
        case 'bullish_engulfing':
            return p.bull && !p1.bull && c.close > c1.open && c.open < c1.close;
        case 'bearish_engulfing':
            return !p.bull && p1.bull && c.open > c1.close && c.close < c1.open;
        case 'morning_star': {
            const mid = c2.close + (c2.open - c2.close) / 2;
            return !p2.bull && p1.body <= p1.range * 0.4 && p.bull && c.close > mid;
        }
        case 'evening_star': {
            const mid = c2.open + (c2.close - c2.open) / 2;
            return p2.bull && p1.body <= p1.range * 0.4 && !p.bull && c.close < mid;
        }
        case 'pinbar':
            return Math.max(p.upper, p.lower) >= p.body * 2.5 && p.body > 0;
        // legacy aliases
        case 'engulfing': return detectCandlePattern(candles, 'bullish_engulfing') || detectCandlePattern(candles, 'bearish_engulfing');
        case 'pin_bar':   return detectCandlePattern(candles, 'pinbar');
        default:          return false;
    }
}

// ── Support / Resistance ──────────────────────────────────────
function calcSupportLevel(candles)    { return Math.min(...candles.slice(-50).map(c => c.low));  }
function calcResistanceLevel(candles) { return Math.max(...candles.slice(-50).map(c => c.high)); }

// ── Swing highs / lows ────────────────────────────────────────
function getSwingHighs(candles, lookback = 20) {
    const w = candles.slice(-lookback);
    const highs = [];
    for (let i = 2; i < w.length - 2; i++) {
        if (w[i].high > w[i-1].high && w[i].high > w[i-2].high &&
            w[i].high > w[i+1].high && w[i].high > w[i+2].high) highs.push(w[i].high);
    }
    return highs;
}

function getSwingLows(candles, lookback = 20) {
    const w = candles.slice(-lookback);
    const lows = [];
    for (let i = 2; i < w.length - 2; i++) {
        if (w[i].low < w[i-1].low && w[i].low < w[i-2].low &&
            w[i].low < w[i+1].low && w[i].low < w[i+2].low) lows.push(w[i].low);
    }
    return lows;
}

// ── Multi-timeframe trend cache ───────────────────────────────
const _mtfCache = new Map(); // key: `${symbol}:${tf}` → { trend, cachedAt }
const TF_TTL_MS   = { '15m':900000,'30m':1800000,'1h':3600000,'2h':7200000,'4h':14400000,'1D':86400000,'1W':604800000 };

async function getMtfTrend(symbol, tf) {
    const key    = `${symbol}:${tf}`;
    const cached = _mtfCache.get(key);
    const ttl    = TF_TTL_MS[tf] || 3600000;
    if (cached && (Date.now() - cached.cachedAt) < ttl) return cached.trend;
    try {
        // Use Binance (same as scanner) — slice last open candle
        const candles = (await fetchCandles(symbol, tf, 62)).slice(0, -1);
        const closes  = candles.map(c => c.close);
        const ema50   = calcEMASeries(closes, 50);
        const last    = closes[closes.length - 1];
        const e50     = ema50[ema50.length - 1];
        let trend = 'neutral';
        if (e50 != null) {
            const diff = (last - e50) / e50;
            if (diff > 0.002) trend = 'bullish';
            else if (diff < -0.002) trend = 'bearish';
        }
        _mtfCache.set(key, { trend, cachedAt: Date.now() });
        return trend;
    } catch (_) { return 'neutral'; }
}

// ── Bybit API (server-side) ──────────────────────────────────
function bybitRequest(apiKey, apiSecret, env, method, endpoint, params = {}) {
    return new Promise((resolve, reject) => {
        const hostname = env === 'mainnet' ? 'api.bybit.com' : 'api-demo.bybit.com';
        const ts         = Date.now().toString();
        const recvWindow = '15000';
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

// ── Human-readable block summary ─────────────────────────────
function blockSummary(block) {
    const p = block.params || {};
    switch (block.type) {
        case 'RSI':           return `RSI(${p.period || 14}) ${p.condition || '<'} ${p.value ?? 30}`;
        case 'RSI_CROSS':     return `RSI cross ${p.direction === 'cross_above' ? 'above' : 'below'} ${p.level ?? 50}`;
        case 'MACD_CROSS':    return `MACD Cross ${p.direction || 'bullish'}`;
        case 'MACD_HIST':     return `MACD Hist ${p.direction === 'above' ? '> 0' : '< 0'}`;
        case 'EMA_CROSS':
        case 'MA_CROSS':      return `${p.maType || 'EMA'}(${p.fastPeriod ?? 12}) ${p.direction === 'above' ? 'above' : 'below'} ${p.maType || 'EMA'}(${p.slowPeriod ?? 26})`;
        case 'PRICE_EMA':
        case 'PRICE_MA':      return `Price ${p.direction === 'below' ? 'below' : 'above'} ${p.maType || 'EMA'}(${p.period ?? 200})`;
        case 'ATR_FILTER':    return `ATR(${p.period || 14}) ${p.condition || '>'} ${p.value ?? 0}`;
        case 'VOLUME':        return `Volume(${p.period || 20}) ${p.condition || '>'} ${p.multiplier ?? 1}×avg`;
        case 'CANDLE_PATTERN':return `Candle Pattern: ${p.pattern || 'any'}`;
        case 'NEAR_SUPPORT':  return `Price near Support (tol: ${p.tolerance ?? 1}%)`;
        case 'NEAR_RESISTANCE':return `Price near Resistance (tol: ${p.tolerance ?? 1}%)`;
        case 'HIGHER_HIGH':   return `Higher High formed`;
        case 'LOWER_LOW':     return `Lower Low formed`;
        case 'TREND_MTF':     return `Trend(${p.timeframe || '4h'}): ${p.direction || 'bullish'}`;
        case 'TREND_ALIGN':   return `Trend Alignment: ${p.timeframeA || '1h'} + ${p.timeframeB || '4h'}`;
        case 'TRADING_HOURS': return `Trading Hours(PKT): ${p.startHour ?? 8}:00–${p.endHour ?? 18}:00`;
        case 'DAY_OF_WEEK':   return `Day of Week: ${(p.days || []).join('/')}`;
        case 'ENTER_LONG':    return `→ ENTER LONG`;
        case 'ENTER_SHORT':   return `→ ENTER SHORT`;
        case 'EXIT_POSITION': return `→ EXIT POSITION`;
        case 'POSITION_SIZE': return `Position Size: ${p.value ?? 1}% capital`;
        case 'STOP_LOSS':     return p.type === 'rr' ? `SL: ${p.value ?? 1}× RR` : `SL: ${p.value ?? 1}% ${p.type || 'pct'}`;
        case 'TAKE_PROFIT':   return p.type === 'rr' ? `TP: ${p.value ?? 2}× RR` : `TP: ${p.value ?? 2}% ${p.type || 'pct'}`;
        case 'ALERT_ONLY':    return `Alert Only`;
        default:              return block.type;
    }
}

function evaluateBlock(block, ind) {
    switch (block.type) {
        case 'RSI': {
            const op  = block.params.condition || '<';
            const thr = +(block.params.value ?? 30);
            const result = compareValue(ind.rsi, op, thr);
            ind._logMsgs?.push(`RSI ${ind.rsi?.toFixed(1)} ${op} ${thr} ${result ? '✓' : '✗'}`);
            return result;
        }
        case 'RSI_CROSS': {
            const lvl = +(block.params.level ?? 50);
            const dir = block.params.direction || 'cross_above';
            let result;
            if (dir === 'cross_above') result = ind.prevRsi < lvl && ind.rsi >= lvl;
            else if (dir === 'cross_below') result = ind.prevRsi > lvl && ind.rsi <= lvl;
            else result = false;
            ind._logMsgs?.push(`RSI ${dir === 'cross_above' ? '↑' : '↓'}${lvl}(${ind.rsi?.toFixed(1)}) ${result ? '✓' : '✗'}`);
            return result;
        }
        case 'MACD_CROSS': {
            const result = block.params.direction === 'bullish'
                ? ind.macd.hist > 0 && ind.macd.histPrev <= 0
                : ind.macd.hist < 0 && ind.macd.histPrev >= 0;
            ind._logMsgs?.push(`MACD ${block.params.direction || 'bullish'} cross ${result ? '✓' : '✗'}`);
            return result;
        }
        case 'MACD_HIST': {
            const result = block.params.direction === 'above' ? ind.macd.hist > 0 : ind.macd.hist < 0;
            ind._logMsgs?.push(`MACD hist ${block.params.direction === 'above' ? '> 0' : '< 0'}(${ind.macd.hist?.toFixed(4)}) ${result ? '✓' : '✗'}`);
            return result;
        }
        case 'EMA_CROSS':
        case 'MA_CROSS': {
            const fp     = +(block.params.fastPeriod ?? 12);
            const sp     = +(block.params.slowPeriod ?? 26);
            const maType = block.params.maType || 'EMA';
            const lookup = maType === 'SMA' ? ind.smas : ind.emas;
            const fast   = lookup[fp], slow = lookup[sp];
            if (fast == null || slow == null) return false;
            const result = block.params.direction === 'above' ? fast > slow : fast < slow;
            ind._logMsgs?.push(`${maType}${fp} ${block.params.direction === 'above' ? 'above' : 'below'} ${maType}${sp} ${result ? '✓' : '✗'}`);
            return result;
        }
        case 'PRICE_EMA':
        case 'PRICE_MA': {
            const p      = +(block.params.period ?? 200);
            const maType = block.params.maType || 'EMA';
            const lookup = maType === 'SMA' ? ind.smas : ind.emas;
            const ma     = lookup[p];
            if (ma == null) return false;
            const result = block.params.direction === 'above' ? ind.price > ma : ind.price < ma;
            ind._logMsgs?.push(`Price ${block.params.direction === 'below' ? 'below' : 'above'} ${maType}${p}(${ma?.toFixed(2)}) ${result ? '✓' : '✗'}`);
            return result;
        }
        case 'STOCHASTIC': {
            const cond = block.params.condition || 'k_below';
            const val  = +(block.params.value ?? 20);
            const { k, d, prevK, prevD } = ind.stoch;
            let result;
            switch (cond) {
                case 'k_cross_above_d': result = prevK < prevD && k >= d; break;
                case 'k_cross_below_d': result = prevK > prevD && k <= d; break;
                case 'k_below':         result = k < val; break;
                case 'k_above':         result = k > val; break;
                case 'kd_both_below':   result = k < val && d < val; break;
                case 'kd_both_above':   result = k > val && d > val; break;
                default:                result = false;
            }
            ind._logMsgs?.push(`Stoch K${k?.toFixed(1)} ${cond}(${val}) ${result ? '✓' : '✗'}`);
            return result;
        }
        case 'VOLUME_SPIKE': {
            const mult   = +(block.params.multiplier ?? 2);
            const result = ind.volumeRatio >= mult;
            ind._logMsgs?.push(`Vol ${ind.volumeRatio?.toFixed(2)}x ≥ ${mult}x ${result ? '✓' : '✗'}`);
            return result;
        }
        case 'ATR': {
            const op     = block.params.condition || '>';
            const thr    = +(block.params.value ?? 0);
            const result = compareValue(ind.atr, op, thr);
            ind._logMsgs?.push(`ATR ${ind.atr?.toFixed(2)} ${op} ${thr} ${result ? '✓' : '✗'}`);
            return result;
        }
        case 'TREND_4H': {
            const dir    = block.params.direction || 'bullish';
            const result = ind.trend4h === dir;
            ind._logMsgs?.push(`4h trend ${ind.trend4h} ${result ? '✓' : '✗'}`);
            return result;
        }
        case 'TREND_1H': {
            const dir    = block.params.direction || 'bullish';
            const result = ind.trend1h === dir;
            ind._logMsgs?.push(`1h trend ${ind.trend1h} ${result ? '✓' : '✗'}`);
            return result;
        }
        case 'TREND_ALIGN': {
            const tfA = block.params.tfA, tfB = block.params.tfB;
            if (tfA && tfB) {
                const tA       = (ind.trendMtf || {})[tfA] || 'neutral';
                const tB       = (ind.trendMtf || {})[tfB] || 'neutral';
                const align    = block.params.alignment || 'full';
                const tradeDir = ind.tradeDir || 'bullish';
                const matchA   = tA === tradeDir;
                const matchB   = tB === tradeDir;
                const result   = align === 'partial' ? (matchA || matchB) : (matchA && matchB);
                ind._logMsgs?.push(`Trend ${tfA}:${tA} ${matchA ? '✓' : '✗'} ${tfB}:${tB} ${matchB ? '✓' : '✗'}`);
                return result;
            }
            return ind.trend4h === ind.trend1h && ind.trend4h !== 'neutral';
        }
        case 'CANDLE_PATTERN': {
            const pat    = block.params.pattern || 'hammer';
            const result = detectCandlePattern(ind.candles5m || [], pat);
            ind._logMsgs?.push(`${pat} pattern ${result ? '✓' : '✗'}`);
            return result;
        }
        case 'NEAR_SUPPORT': {
            const support = calcSupportLevel(ind.candles5m || []);
            const pct     = +(block.params.pct ?? 1);
            const result  = ind.price >= support && ind.price <= support * (1 + pct / 100);
            ind._logMsgs?.push(`Near Support(${support.toFixed(2)}) ±${pct}% ${result ? '✓' : '✗'}`);
            return result;
        }
        case 'NEAR_RESISTANCE': {
            const resistance = calcResistanceLevel(ind.candles5m || []);
            const pct        = +(block.params.pct ?? 1);
            const result     = ind.price <= resistance && ind.price >= resistance * (1 - pct / 100);
            ind._logMsgs?.push(`Near Resist(${resistance.toFixed(2)}) ±${pct}% ${result ? '✓' : '✗'}`);
            return result;
        }
        case 'HIGHER_HIGH': {
            const highs  = getSwingHighs(ind.candles5m || []);
            const result = highs.length >= 2 && highs[highs.length - 1] > highs[highs.length - 2];
            ind._logMsgs?.push(`Higher High ${result ? '✓' : '✗'}`);
            return result;
        }
        case 'LOWER_LOW': {
            const lows   = getSwingLows(ind.candles5m || []);
            const result = lows.length >= 2 && lows[lows.length - 1] < lows[lows.length - 2];
            ind._logMsgs?.push(`Lower Low ${result ? '✓' : '✗'}`);
            return result;
        }
        case 'TREND_MTF': {
            const tf     = block.params.timeframe || '4h';
            const dir    = block.params.direction || 'bullish';
            const trend  = (ind.trendMtf || {})[tf] || 'neutral';
            const result = dir === 'any' ? trend !== 'neutral' : trend === dir;
            ind._logMsgs?.push(`${tf} ${trend} ${result ? '✓' : '✗'}`);
            return result;
        }
        case 'TRADING_HOURS': {
            const pkt    = new Date(Date.now() + 5 * 3600000);
            const hr     = pkt.getUTCHours() + pkt.getUTCMinutes() / 60;
            const start  = +(block.params.startHour ?? 8);
            const end    = +(block.params.endHour ?? 18);
            const result = hr >= start && hr <= end;
            const pktStr = `${String(pkt.getUTCHours()).padStart(2,'0')}:${String(pkt.getUTCMinutes()).padStart(2,'0')} PKT`;
            ind._logMsgs?.push(`${pktStr} ∈ [${start}:00-${end}:00] ${result ? '✓' : '✗'}`);
            return result;
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
// _debugFirstScan tracks whether the one-time indicator debug log has fired
const _debugFirstScan = new Set();

async function calcIndicators(symbol, timeframe, emaPeriods, smaPeriods, mtfTimeframes = []) {
    // Fetch from Binance Futures (same exchange as scanner) with +1 candle so
    // we can safely drop the last open candle via slice(0, -1).
    const [cRaw, c1hRaw, c4hRaw] = await Promise.all([
        fetchCandles(symbol, timeframe, 201),
        fetchCandles(symbol, '1h', 61),
        fetchCandles(symbol, '4h', 61),
    ]);

    // Always drop last (currently open) candle — matches scanner behavior
    const candles  = cRaw.slice(0, -1);
    const c1h      = c1hRaw.slice(0, -1);
    const c4h      = c4hRaw.slice(0, -1);

    const closes = candles.map(c => c.close);
    const rsi    = calcRSI(closes);
    const prevRsi = calcRSI(closes.slice(0, -1));
    const macd   = calcMACD(closes);
    const atr    = calcATR(candles);
    const price  = closes[closes.length - 1] ?? 0;
    const stoch  = calcStochastic(candles);
    const volumeRatio = calcVolumeRatio(candles);

    const emas = {};
    for (const p of emaPeriods) {
        const ser = calcEMASeries(closes, p);
        emas[p] = ser[ser.length - 1];
    }
    const smas = {};
    for (const p of smaPeriods) {
        const ser = calcSMASeries(closes, p);
        smas[p] = ser[ser.length - 1];
    }

    // MTF trend — fetched with per-timeframe caching
    const trendMtf = {};
    if (mtfTimeframes.length > 0) {
        await Promise.all(mtfTimeframes.map(async tf => {
            trendMtf[tf] = await getMtfTrend(symbol, tf);
        }));
    }

    return {
        price, rsi, prevRsi, macd, atr, volumeRatio, emas, smas, stoch,
        trend4h:  getTrend(c4h),
        trend1h:  getTrend(c1h),
        trendMtf,
        candles5m: candles,
    };
}

function getNeededPeriods(allBlocks) {
    const emaPeriods   = new Set();
    const smaPeriods   = new Set();
    const mtfTimeframes = new Set();
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
        if (b.type === 'TREND_MTF' && b.params.timeframe) mtfTimeframes.add(b.params.timeframe);
        if (b.type === 'TREND_ALIGN') {
            if (b.params.tfA) mtfTimeframes.add(b.params.tfA);
            if (b.params.tfB) mtfTimeframes.add(b.params.tfB);
        }
    }
    return { emaPeriods: [...emaPeriods], smaPeriods: [...smaPeriods], mtfTimeframes: [...mtfTimeframes] };
}

function getSLBlock(actions) { return actions.find(b => b.type === 'STOP_LOSS'); }
function getTPBlock(actions) { return actions.find(b => b.type === 'TAKE_PROFIT'); }
function getSizeBlock(actions) { return actions.find(b => b.type === 'POSITION_SIZE'); }

async function getBybitPositions(store) {
    if (!store?.apiKey) return [];
    // Let errors propagate to callers so they can handle grace-fully
    // instead of silently returning [] on failure (which hides bugs).
    const res = await bybitRequest(
        store.apiKey, store.apiSecret, store.env,
        'GET', '/v5/position/list', { category: 'linear', settleCoin: 'USDT' }
    );
    return (res?.result?.list || []).filter(p => +p.size > 0);
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

// ── Strict singleton timer registry ──────────────────────────
// Tracks the ONE active candle-poll interval per userId.
// Separating this from the bot object prevents any race where
// the timerId reference is lost before clearInterval is called.
const _timers = new Map(); // userId → intervalId

function clearBotTimer(userId) {
    if (_timers.has(userId)) {
        clearInterval(_timers.get(userId));
        _timers.delete(userId);
    }
}

function setBotTimer(userId) {
    clearBotTimer(userId); // always evict the previous timer first
    const id = setInterval(() => pollCandle(userId), 30000);
    _timers.set(userId, id);
    if (_timers.size > 1) {
        // This should never be > total active users — log if something looks wrong
        console.warn(`[strategyBot] ${_timers.size} candle timers active (expected ≤ active users)`);
    }
    return id;
}

function setIO(io) { _io = io; }

function addLog(userId, level, message) {
    // In-memory store for fast getLogs() access (recent 100)
    const logs = botLogs.get(userId) || [];
    logs.unshift({ level, message, ts: Date.now() });
    if (logs.length > 100) logs.pop();
    botLogs.set(userId, logs);

    // Persist to MongoDB (fire-and-forget — never block the scan cycle)
    const strategyId = bots.get(userId)?.strategyId || null;
    BotLog.create({ userId, strategyId, level, message })
        .then(() => {
            // Enforce 10,000 log limit per user — trim oldest if exceeded
            BotLog.countDocuments({ userId }).then(count => {
                if (count > 10000) {
                    const excess = count - 10000;
                    BotLog.find({ userId }).sort({ timestamp: 1 }).limit(excess)
                        .select('_id').lean()
                        .then(docs => BotLog.deleteMany({ _id: { $in: docs.map(d => d._id) } }))
                        .catch(() => {});
                }
            }).catch(() => {});
        })
        .catch(() => {});

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

async function getTelegramBotSettings(userId) {
    try {
        const settings = await Settings.findOne({ userId }).lean();
        const telegram = settings?.telegram;
        if (!telegram?.chatId) return null;
        if (telegram?.alerts?.strategyBotAlerts === false) return null;
        return { botToken: require('./telegramBot').getBotToken(), chatId: telegram.chatId };
    } catch (_) { return null; }
}

async function checkClosedTrades(userId, store, strategyId) {
    if (!store) return;
    const openTrades = await BotTrade.find({ userId, strategyId, status: 'open' }).lean().catch(() => []);
    if (!openTrades.length) return;
    const bybitPositions = await getBybitPositions(store).catch(() => []);
    const openSymbols    = new Set(bybitPositions.map(p => p.symbol));

    const webhook     = await getStrategyBotWebhook(userId);
    const tgSettings  = await getTelegramBotSettings(userId);
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
        if (tgSettings) {
            sendTelegramStrategyBotAlert(tgSettings.botToken, tgSettings.chatId, closeType, {
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

        const blocks    = strategy.blocks || { filters: [], ifBlocks: [], exitConditions: [] };
        const coins     = strategy.coins?.length ? strategy.coins : ['BTCUSDT', 'ETHUSDT'];
        const maxTPD    = strategy.maxTradesPerDay || 3;
        const tf        = strategy.timeframe || '5m';

        // Guardrail: max trades per day (counted from PKT midnight)
        const dayStart    = getPKTDayStart();
        const tradesToday = await BotTrade.countDocuments({
            userId, strategyId: bot.strategyId, openedAt: { $gte: dayStart },
        });
        addLog(userId, 'info', `Trades today (PKT): ${tradesToday}/${maxTPD}`);
        if (tradesToday >= maxTPD) {
            addLog(userId, 'warn', `Max trades reached: ${tradesToday}/${maxTPD} — bot pausing until midnight PKT`);
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
        const { emaPeriods, smaPeriods, mtfTimeframes } = getNeededPeriods(allCondBlocks);

        // ── Position guard ──
        // Always call Bybit API live. On error → default to SKIP (safe).
        let bybitPositions = [];
        let posApiError    = null;
        try {
            bybitPositions = store ? await getBybitPositions(store) : [];
        } catch (e) {
            posApiError = e.message;
        }

        const bybitHasPos = bybitPositions.length > 0;
        const openDbCount = await BotTrade.countDocuments({ userId, strategyId: bot.strategyId, status: 'open' }).catch(() => 0);
        const dbHasPos    = openDbCount > 0;

        let hasOpenPosition;
        if (posApiError) {
            // API unavailable — default to SKIP to avoid double-entry risk
            hasOpenPosition = true;
            addLog(userId, 'warn', `Bybit position API error — defaulting to SKIP (safe): ${posApiError}`);
        } else if (!bybitHasPos && dbHasPos) {
            // Mismatch: Bybit clear, but DB has open records → checkClosedTrades will reconcile
            hasOpenPosition = false;
            addLog(userId, 'warn', `Position flag mismatch — Bybit shows no position, clearing hasOpenPosition flag`);
        } else {
            hasOpenPosition = bybitHasPos && dbHasPos;
        }

        if (!posApiError) {
            if (hasOpenPosition) {
                const topPos = bybitPositions[0];
                addLog(userId, 'info', `Bybit check — ${bybitPositions.length} open position(s)${topPos ? ` (${topPos.symbol} ${topPos.side || ''})` : ''} — skipping scan`);
            } else {
                addLog(userId, 'info', `Bybit check — 0 open positions — proceeding with scan`);
            }
        }

        let foundSignals = 0;

        for (let i = 0; i < coins.length; i++) {
            const sym = coins[i];
            emit(userId, 'strategy:scan_progress', { scanned: i + 1, total: coins.length, symbol: sym });

            try {
                const ind = await calcIndicators(sym, tf, emaPeriods, smaPeriods, mtfTimeframes);

                // One-time debug log on first scan — verify values match scanner
                if (!_debugFirstScan.has(userId) && sym === coins[0]) {
                    _debugFirstScan.add(userId);
                    addLog(userId, 'info', `DEBUG ${sym} indicators — RSI: ${ind.rsi?.toFixed(1)} | MACD hist: ${ind.macd?.hist?.toFixed(4)} | ATR: ${ind.atr?.toFixed(4)} | Vol×: ${ind.volumeRatio?.toFixed(2)} | Price: ${ind.price}`);
                }
                ind._logMsgs = [];

                // ── Filters ──
                const passFilters = evaluateFilterBlocks(filters, ind);
                ind._logMsgs = [];
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
                if (hasOpenPosition) {
                    const topPos = bybitPositions[0];
                    addLog(userId, 'info', `Skipping scan — ${sym} ${topPos?.side || 'Buy'} position open`);
                    continue;
                }

                // ── IF / ELSE IF / ELSE evaluation ──
                let matched = false;
                for (const ifBlock of ifBlocks) {
                    // Expose trade direction to TREND_ALIGN block evaluation
                    const ifActions  = ifBlock.actions || [];
                    const ifDirBlock = ifActions.find(b => ['ENTER_LONG', 'ENTER_SHORT'].includes(b.type));
                    ind.tradeDir = ifDirBlock?.type === 'ENTER_SHORT' ? 'bearish' : 'bullish';

                    let condMet = false;
                    let blockEvalStr = '';

                    if (ifBlock.type === 'else') {
                        condMet = true; // ELSE always matches if we get here
                        blockEvalStr = 'ELSE';
                    } else {
                        ind._logMsgs = [];
                        condMet = evaluateConditionBlocks(ifBlock.conditions || [], ind);
                        blockEvalStr = (ind._logMsgs || []).join(' AND ') || ifBlock.type;
                        ind._logMsgs = [];

                        if (!condMet) {
                            addLog(userId, 'info', `${sym} — ${ifBlock.type.toUpperCase()} (${blockEvalStr}) ✗`);
                            continue;
                        }
                    }

                    const actions  = ifBlock.actions || [];
                    const dirBlock = actions.find(b => ['ENTER_LONG', 'ENTER_SHORT'].includes(b.type));
                    const isAlertOnly = actions.some(b => b.type === 'ALERT_ONLY') || alertOnly;
                    const side     = dirBlock?.type === 'ENTER_SHORT' ? 'Sell' : 'Buy';
                    const dir      = side === 'Buy' ? 'LONG' : 'SHORT';

                    emit(userId, 'strategy:conditions_met', { symbol: sym, side: dir, conditions: blockEvalStr });

                    if (isAlertOnly) {
                        addLog(userId, 'signal', `${sym} matched ${ifBlock.type.toUpperCase()} (${blockEvalStr}) → alert-only`);
                        try {
                            await notifier.sendAlert(userId, `🔔 STRATEGY ALERT — ${sym}\nStrategy: ${strategy.name}\nSignal: ${dir}\nBlock: ${ifBlock.type}\nPrice: ${ind.price}\n${new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' })} PKT`);
                        } catch (_) {}
                        matched = true;
                        break;
                    }

                    // Guardrail: daily drawdown check (PKT midnight)
                    const closedToday = await BotTrade.find({ userId, openedAt: { $gte: dayStart }, status: 'closed' }).lean();
                    const todayPnL    = closedToday.reduce((s, t) => s + (t.pnl || 0), 0);
                    const ddLimit     = strategy.dailyDrawdownLimit ?? 50;
                    const ddAbs       = Math.abs(todayPnL).toFixed(2);
                    const ddSign      = todayPnL >= 0 ? '+' : '-';
                    if (todayPnL < 0 && Math.abs(todayPnL) >= ddLimit) {
                        addLog(userId, 'warn', `Drawdown check — Today PnL: -$${ddAbs} — limit: $${ddLimit} — stopping bot`);
                        await stopBot(userId);
                        return;
                    }
                    addLog(userId, 'info', `Drawdown check — Today PnL: ${ddSign}$${ddAbs} — limit: $${ddLimit} — OK`);

                    // Place order
                    try {
                        const { orderId, sl, tp, qty } = await placeOrder(userId, sym, side, ind.price, ind.atr, actions, store);
                        await BotTrade.create({
                            userId, strategyId: bot.strategyId, symbol: sym, side: dir,
                            entryPrice: ind.price, sl, tp, quantity: qty, status: 'open',
                            conditionsMet: { conditions: blockEvalStr },
                        });
                        addLog(userId, 'trade', `${sym} matched ${ifBlock.type.toUpperCase()} (${blockEvalStr}) → ${dir} @ ${ind.price} | SL: ${sl ?? 'none'} | TP: ${tp ?? 'none'} | Qty: ${qty}`);
                        emit(userId, 'strategy:order_placed', { symbol: sym, side: dir, entry: ind.price, sl, tp });
                        // Discord notification
                        getStrategyBotWebhook(userId).then(wh => {
                            if (wh) sendStrategyBotAlert(wh, 'trade_placed', {
                                symbol: sym, direction: dir, entryPrice: ind.price,
                                sl, tp, qty, strategyName: strategy.name,
                            }).catch(() => {});
                        }).catch(() => {});
                        getTelegramBotSettings(userId).then(tg => {
                            if (tg) sendTelegramStrategyBotAlert(tg.botToken, tg.chatId, 'trade_placed', {
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

                if (!matched) {
                    // Silent — no need to log every non-match
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

        const tf      = strategy.timeframe || '5m';
        const refCoin = strategy.coins?.[0] || 'BTCUSDT';

        // Use Binance (same source as indicator calculation) to detect candle close
        const candles = await fetchCandles(refCoin, tf, 2);
        if (!candles.length) return;

        const latestTs = candles[candles.length - 1].time;
        if (!bot.lastCandleTs || latestTs > bot.lastCandleTs) {
            bot.lastCandleTs = latestTs;
            addLog(userId, 'info', `New ${tf} candle detected — scanning`);
            // Wait 500ms for Binance to finalize the closed candle before scanning
            await new Promise(r => setTimeout(r, 500));
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
            timerId: setBotTimer(userId),
        };
        bots.set(userId, bot);
        addLog(userId, 'info', `Bot started — strategy: "${strategy?.name}" | coins: ${(strategy?.coins || []).join(', ') || 'default'} | if-blocks: ${(strategy?.blocks?.ifBlocks || []).length}`);
        const _maxTPD = strategy?.maxTradesPerDay;
        if (!_maxTPD) addLog(userId, 'warn', `maxTradesPerDay not set — defaulting to 3`);
        else          addLog(userId, 'info', `Max trades per day: ${_maxTPD} (loaded from strategy)`);
        const _ddl    = strategy?.dailyDrawdownLimit;
        if (!_ddl)    addLog(userId, 'warn', `dailyDrawdownLimit not set — defaulting to $50`);
        else          addLog(userId, 'info', `Daily drawdown limit: $${_ddl}`);

        // Discord bot start notification
        getStrategyBotWebhook(userId).then(wh => {
            if (wh) sendStrategyBotAlert(wh, 'bot_start', {
                strategyName: strategy?.name,
                timeframe:    strategy?.timeframe || '5m',
                coinCount:    (strategy?.coins || []).length,
            }).catch(() => {});
        }).catch(() => {});
        getTelegramBotSettings(userId).then(tg => {
            if (tg) sendTelegramStrategyBotAlert(tg.botToken, tg.chatId, 'bot_start', {
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
    clearBotTimer(userId); // always clear the singleton timer first
    const bot = bots.get(userId);
    if (bot) {
        clearInterval(bot.timerId); // belt-and-suspenders: clear bot ref too
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

    getTelegramBotSettings(userId).then(async tg => {
        if (!tg) return;
        const strategyDoc = await Strategy.findById(trade.strategyId).lean().catch(() => null);
        sendTelegramStrategyBotAlert(tg.botToken, tg.chatId, 'manual_close', {
            symbol: trade.symbol, direction: trade.side,
            entryPrice: trade.entryPrice, exitPrice,
            pnl, pnlPct, strategyName: strategyDoc?.name,
        }).catch(() => {});
    }).catch(() => {});

    return updated;
}

module.exports = { setIO, startBot, stopBot, getStatus, getLogs, resumeActiveBots, closeTradeManually };
