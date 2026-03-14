'use strict';

/**
 * coinScanner.js — Multi-timeframe coin filtering + AI quality scoring
 *
 * Phase 1: Hard filters (volume, ATR, EMA trend alignment, RSI)
 * Phase 2: AI scoring via Kimi moonshot-v1-8k
 */

const { Settings, BybitStore } = require('./models');
const { analyzeWithAI }        = require('./aiAnalysis');

// ── Technical indicators ──────────────────────────────────────

function calcEMASeries(values, period) {
    if (!values.length) return [];
    const k   = 2 / (period + 1);
    const out = [values[0]];
    for (let i = 1; i < values.length; i++) {
        out.push(values[i] * k + out[i - 1] * (1 - k));
    }
    return out;
}

function calcRSI(closes, period = 14) {
    if (closes.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const d = closes[i] - closes[i - 1];
        if (d > 0) gains += d; else losses -= d;
    }
    let avgG = gains / period, avgL = losses / period;
    for (let i = period + 1; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1];
        avgG = (avgG * (period - 1) + Math.max(0, d)) / period;
        avgL = (avgL * (period - 1) + Math.max(0, -d)) / period;
    }
    if (avgL === 0) return 100;
    return 100 - 100 / (1 + avgG / avgL);
}

function calcATR(candles, period = 14) {
    if (candles.length < 2) return 0;
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
        const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
        trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    if (trs.length < period) return trs[trs.length - 1] || 0;
    let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) {
        atr = (atr * (period - 1) + trs[i]) / period;
    }
    return atr;
}

function calcMACD(closes) {
    const ema12  = calcEMASeries(closes, 12);
    const ema26  = calcEMASeries(closes, 26);
    const macdL  = ema12.map((v, i) => v - ema26[i]);
    const signal = calcEMASeries(macdL, 9);
    const hist   = macdL.map((v, i) => v - signal[i]);
    return {
        macd:   macdL[macdL.length - 1],
        signal: signal[signal.length - 1],
        hist:   hist[hist.length - 1],
    };
}

function calcRSISeries(closes, period = 14) {
    const out = new Array(period).fill(50);
    for (let i = period; i < closes.length; i++) {
        out.push(calcRSI(closes.slice(0, i + 1), period));
    }
    return out;
}

function detectDivergence(closes, rsiSeries, lookback = 20) {
    if (closes.length < lookback) return 'none';
    const pW = closes.slice(-lookback),   rW = rsiSeries.slice(-lookback);
    const pH = Math.max(...pW), pL = Math.min(...pW);
    const rH = Math.max(...rW), rL = Math.min(...rW);
    const lP = pW[pW.length - 1], lR = rW[rW.length - 1];
    if (lP >= pH * 0.99 && lR < rH * 0.95) return 'bearish';
    if (lP <= pL * 1.01 && lR > rL * 1.05) return 'bullish';
    return 'none';
}

function swingHighsLows(candles, lookback = 5) {
    const highs = [], lows = [];
    for (let i = lookback; i < candles.length - lookback; i++) {
        const slice = candles.slice(i - lookback, i + lookback + 1);
        if (slice.every((c, idx) => idx === lookback || c.high < candles[i].high)) highs.push(candles[i].high);
        if (slice.every((c, idx) => idx === lookback || c.low  > candles[i].low))  lows.push(candles[i].low);
    }
    return { highs: highs.slice(-5), lows: lows.slice(-5) };
}

// ── Binance Futures fetch helpers ─────────────────────────────

async function fetchTicker(sym) {
    const r = await fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${sym}`);
    if (!r.ok) throw new Error(`Ticker ${sym}: HTTP ${r.status}`);
    return r.json();
}

async function fetchCandles(sym, interval, limit) {
    const r = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${interval}&limit=${limit}`);
    if (!r.ok) throw new Error(`Candles ${sym}/${interval}: HTTP ${r.status}`);
    return (await r.json()).map(c => ({
        time: c[0], open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +c[5],
    }));
}

// ── Bybit open positions ──────────────────────────────────────

async function getBybitOpenSymbols(creds) {
    if (!creds) return [];
    try {
        const crypto = require('crypto');
        const base   = creds.env === 'testnet' ? 'https://api-demo.bybit.com' : 'https://api.bybit.com';
        const ts     = Date.now().toString();
        const recv   = '20000';
        const qs     = 'category=linear&settleCoin=USDT';
        const sign   = crypto.createHmac('sha256', creds.apiSecret).update(ts + creds.apiKey + recv + qs).digest('hex');
        const r = await fetch(`${base}/v5/position/list?${qs}`, {
            headers: { 'X-BAPI-API-KEY': creds.apiKey, 'X-BAPI-SIGN': sign, 'X-BAPI-TIMESTAMP': ts, 'X-BAPI-RECV-WINDOW': recv },
        });
        const d = await r.json();
        return (d.result?.list || []).filter(p => +p.size > 0).map(p => p.symbol);
    } catch { return []; }
}

// ── Phase 1: Hard filters ─────────────────────────────────────

async function applyHardFilters(sym, agentSettings, openSyms) {
    if (openSyms.includes(sym)) return null;

    const [ticker, c4h, c1h, c5m] = await Promise.all([
        fetchTicker(sym),
        fetchCandles(sym, '4h', 50),
        fetchCandles(sym, '1h', 50),
        fetchCandles(sym, '5m', 100),
    ]);

    // 1. Volume > 30M
    if (parseFloat(ticker.quoteVolume) < (agentSettings.minVolume || 30) * 1e6) return null;

    // 2. ATR(14) on 5m within threshold
    const atr5m = calcATR(c5m, 14);
    if (atr5m < (agentSettings.atrMin || 0) || atr5m > (agentSettings.atrMax || 9999999)) return null;

    // 3. 4H EMA20 vs EMA50 — clear trend (not flat)
    const cls4h = c4h.map(c => c.close);
    const e20_4 = calcEMASeries(cls4h, 20);
    const e50_4 = calcEMASeries(cls4h, 50);
    const lE20  = e20_4[e20_4.length - 1];
    const lE50  = e50_4[e50_4.length - 1];
    if (Math.abs(lE20 - lE50) / lE50 < 0.002) return null;   // too flat
    const trend4h = lE20 > lE50 ? 'long' : 'short';

    // 4. 1H trend agrees with 4H
    const cls1h = c1h.map(c => c.close);
    const e20_1 = calcEMASeries(cls1h, 20);
    const e50_1 = calcEMASeries(cls1h, 50);
    const trend1h = e20_1[e20_1.length - 1] > e50_1[e50_1.length - 1] ? 'long' : 'short';
    if (trend1h !== trend4h) return null;

    // 5. RSI(14) on 5m < 38 for long OR > 62 for short
    const cls5m = c5m.map(c => c.close);
    const rsi5m = calcRSI(cls5m, 14);
    if (trend4h === 'long'  && rsi5m >= 38) return null;
    if (trend4h === 'short' && rsi5m <= 62) return null;

    return { symbol: sym, direction: trend4h, ticker, c4h, c1h, c5m, rsi5m, atr5m };
}

// ── Phase 2: AI quality scoring ───────────────────────────────

async function scoreWithAI(candidate, userSettings) {
    const cls5m  = candidate.c5m.map(c => c.close);
    const macd   = calcMACD(cls5m);
    const rsiSer = calcRSISeries(cls5m, 14);
    const diverg = detectDivergence(cls5m, rsiSer);
    const swings = swingHighsLows(candidate.c5m);
    const vol20  = candidate.c5m.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
    const volR   = (candidate.c5m[candidate.c5m.length - 1].volume / (vol20 || 1)).toFixed(2);
    const cls4h  = candidate.c4h.map(c => c.close);
    const e20_4  = calcEMASeries(cls4h, 20);
    const e50_4  = calcEMASeries(cls4h, 50);
    const f4 = v => parseFloat(v).toFixed(4);
    const fmtC = arr => arr.map(c => [f4(c.open), f4(c.high), f4(c.low), f4(c.close), (c.volume / 1000).toFixed(1)]);

    const prompt =
`You are a professional crypto trading analyst. Analyze this setup and return ONLY valid JSON — no markdown, no explanation, no backticks.

Symbol: ${candidate.symbol}
Direction bias: ${candidate.direction.toUpperCase()}

4H candles (last 30, oldest first) [open,high,low,close,vol_k]:
${JSON.stringify(fmtC(candidate.c4h.slice(-30)))}

1H candles (last 30, oldest first):
${JSON.stringify(fmtC(candidate.c1h.slice(-30)))}

5m candles (last 50, oldest first):
${JSON.stringify(fmtC(candidate.c5m.slice(-50)))}

Indicators:
- RSI(14) 5m: ${candidate.rsi5m.toFixed(2)}
- MACD 5m: macd=${f4(macd.macd)} signal=${f4(macd.signal)} hist=${f4(macd.hist)}
- ATR(14) 5m: ${f4(candidate.atr5m)}
- Volume ratio vs 20-avg: ${volR}x
- Divergence (5m): ${diverg}
- 4H EMA20: ${f4(e20_4[e20_4.length - 1])}, EMA50: ${f4(e50_4[e50_4.length - 1])}
- S/R swing highs: ${JSON.stringify(swings.highs.map(f4))}
- S/R swing lows:  ${JSON.stringify(swings.lows.map(f4))}
- HTF trend: ${candidate.direction.toUpperCase()} (4H + 1H aligned)

Return ONLY this JSON object (no extra text):
{"score":0,"direction":"long","entry":0,"sl":0,"tp1":0,"tp2":0,"rr":0,"confidence":"low","reasoning":""}`;

    const raw = await analyzeWithAI(prompt, userSettings);
    const cleaned = raw.replace(/```json?/gi, '').replace(/```/g, '').trim();
    try {
        return { ...JSON.parse(cleaned), symbol: candidate.symbol };
    } catch {
        throw new Error(`Invalid AI JSON for ${candidate.symbol}: ${cleaned.slice(0, 100)}`);
    }
}

// ── Main scan function ────────────────────────────────────────

async function runScan(creds, agentSettings, userSettings, emitFn) {
    const settingsDoc = await Settings.findOne({ userId: 'default' }).lean();
    const symbols     = (settingsDoc?.symbols || []).filter(Boolean);

    if (!symbols.length) {
        emitFn('agent:log', { level: 'warn', message: 'No coins in scanner list. Add coins in Settings → Coins.' });
        return [];
    }

    emitFn('agent:scan_started', { count: symbols.length });
    emitFn('agent:log', { level: 'info', message: `Scanning ${symbols.length} coins with hard filters...` });

    const openSyms   = await getBybitOpenSymbols(creds);
    const candidates = [];

    for (const sym of symbols) {
        try {
            const res = await applyHardFilters(sym, agentSettings, openSyms);
            if (res) {
                candidates.push(res);
                emitFn('agent:log', { level: 'info', message: `✓ ${sym} passed — ${res.direction.toUpperCase()} RSI=${res.rsi5m.toFixed(1)}` });
            }
            await new Promise(r => setTimeout(r, 120)); // Binance rate-limit courtesy
        } catch (e) {
            emitFn('agent:log', { level: 'warn', message: `${sym}: ${e.message}` });
        }
    }

    emitFn('agent:scan_complete', { candidates: candidates.length });

    if (!candidates.length) {
        emitFn('agent:log', { level: 'info', message: 'No candidates passed hard filters' });
        return [];
    }

    emitFn('agent:log', { level: 'info', message: `${candidates.length} candidate(s) → AI scoring...` });

    const scored = [];
    for (const c of candidates) {
        try {
            emitFn('agent:ai_scoring', { symbol: c.symbol });
            emitFn('agent:log', { level: 'info', message: `AI scoring ${c.symbol}...` });
            const result = await scoreWithAI(c, userSettings);
            scored.push(result);
            const minScore = agentSettings.minScore || 75;
            emitFn('agent:log', {
                level:   result.score >= minScore ? 'success' : 'info',
                message: `${c.symbol}: score=${result.score} conf=${result.confidence} dir=${result.direction}`,
            });
        } catch (e) {
            emitFn('agent:log', { level: 'error', message: `AI error ${c.symbol}: ${e.message}` });
        }
    }

    const minScore = agentSettings.minScore || 75;
    return scored
        .filter(s => s.score >= minScore && ['medium', 'high'].includes(s.confidence))
        .sort((a, b) => b.score - a.score);
}

// ── Hard-filter-only scan (no AI scoring) ────────────────────

async function runHardFilterScan(agentSettings, emitFn) {
    const settingsDoc = await Settings.findOne({ userId: 'default' }).lean();
    const symbols     = (settingsDoc?.symbols || []).filter(Boolean);

    if (!symbols.length) {
        emitFn('setups:done', { candidates: [] });
        return [];
    }

    emitFn('setups:start', { total: symbols.length });
    emitFn('setups:log', { message: `Scanning ${symbols.length} coins with hard filters…`, level: 'info' });

    const candidates = [];
    for (const sym of symbols) {
        try {
            const res = await applyHardFilters(sym, agentSettings || {}, []);
            if (res) {
                candidates.push(res);
                emitFn('setups:log', { message: `✓ ${sym} passed — ${res.direction.toUpperCase()} RSI=${res.rsi5m.toFixed(1)}`, level: 'pass' });
            } else {
                emitFn('setups:log', { message: `✗ ${sym} filtered out`, level: 'filtered' });
            }
            await new Promise(r => setTimeout(r, 120));
        } catch (e) {
            emitFn('setups:log', { message: `${sym}: ${e.message}`, level: 'error' });
        }
    }

    const out = candidates.map(c => ({
        symbol:    c.symbol,
        direction: c.direction,
        rsi5m:     parseFloat(c.rsi5m.toFixed(1)),
        atr5m:     parseFloat(c.atr5m.toFixed(6)),
        price:     parseFloat(c.ticker?.lastPrice || 0),
        volume:    parseFloat((parseFloat(c.ticker?.quoteVolume || 0) / 1e6).toFixed(1)),
    }));

    emitFn('setups:done', { candidates: out });
    return out;
}

module.exports = { runScan, runHardFilterScan };
