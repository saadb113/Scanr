'use strict';

/**
 * coinScanner.js — Multi-timeframe coin filtering + AI quality scoring
 *
 * Phase 1: Hard filters (volume, ATR, EMA trend alignment, RSI)
 * Phase 2: AI scoring via Kimi moonshot-v1-8k
 */

const { Settings, BybitStore } = require('./models');
const { analyzeWithAI }        = require('./aiAnalysis');
const {
    calcEMASeries,
    calcRSI,
    calcATR,
    calcMACD,
    fetchCandles,
} = require('./utils/indicators');

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

    const tf = agentSettings.timeframe || '5m';
    const [ticker, c4h, c1h, cEntry] = await Promise.all([
        fetchTicker(sym),
        fetchCandles(sym, '4h', 50),
        fetchCandles(sym, '1h', 50),
        fetchCandles(sym, tf, 100),
    ]);

    // Drop the last (currently open) candle for indicator calculation
    const c4hClosed    = c4h.slice(0, -1);
    const c1hClosed    = c1h.slice(0, -1);
    const cEntryClosed = cEntry.slice(0, -1);

    // 1. Volume > 30M
    if (parseFloat(ticker.quoteVolume) < (agentSettings.minVolume || 30) * 1e6) return null;

    // 2. ATR(14) on entry timeframe within threshold
    const atrEntry = calcATR(cEntryClosed, 14);
    if (atrEntry < (agentSettings.atrMin || 0) || atrEntry > (agentSettings.atrMax || 9999999)) return null;

    // 3. 4H EMA20 vs EMA50 — clear trend (not flat)
    const cls4h = c4hClosed.map(c => c.close);
    const e20_4 = calcEMASeries(cls4h, 20);
    const e50_4 = calcEMASeries(cls4h, 50);
    const lE20  = e20_4[e20_4.length - 1];
    const lE50  = e50_4[e50_4.length - 1];
    if (Math.abs(lE20 - lE50) / lE50 < 0.002) return null;   // too flat
    const trend4h = lE20 > lE50 ? 'long' : 'short';

    // 4. 1H trend agrees with 4H
    const cls1h = c1hClosed.map(c => c.close);
    const e20_1 = calcEMASeries(cls1h, 20);
    const e50_1 = calcEMASeries(cls1h, 50);
    const trend1h = e20_1[e20_1.length - 1] > e50_1[e50_1.length - 1] ? 'long' : 'short';
    if (trend1h !== trend4h) return null;

    // 5. RSI(14) on entry timeframe < 38 for long OR > 62 for short
    const clsEntry = cEntryClosed.map(c => c.close);
    const rsiEntry = calcRSI(clsEntry, 14);
    if (trend4h === 'long'  && rsiEntry >= 38) return null;
    if (trend4h === 'short' && rsiEntry <= 62) return null;

    // Keep full candle arrays (including open candle) for AI prompt context
    return { symbol: sym, direction: trend4h, ticker, c4h, c1h, cEntry, rsiEntry, atrEntry, timeframe: tf };
}

// ── Phase 2: AI quality scoring ───────────────────────────────

async function scoreWithAI(candidate, userSettings) {
    const tf     = candidate.timeframe || '5m';
    const clsEntry = candidate.cEntry.map(c => c.close);
    const macd   = calcMACD(clsEntry);
    const rsiSer = calcRSISeries(clsEntry, 14);
    const diverg = detectDivergence(clsEntry, rsiSer);
    const swings = swingHighsLows(candidate.cEntry);
    const vol20  = candidate.cEntry.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
    const volR   = (candidate.cEntry[candidate.cEntry.length - 1].volume / (vol20 || 1)).toFixed(2);
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

${tf} candles (last 50, oldest first):
${JSON.stringify(fmtC(candidate.cEntry.slice(-50)))}

Indicators:
- RSI(14) ${tf}: ${candidate.rsiEntry.toFixed(2)}
- MACD ${tf}: macd=${f4(macd.macd)} signal=${f4(macd.signal)} hist=${f4(macd.hist)}
- ATR(14) ${tf}: ${f4(candidate.atrEntry)}
- Volume ratio vs 20-avg: ${volR}x
- Divergence (${tf}): ${diverg}
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
    let symbols;
    const customList = (agentSettings.customCoins || '').trim();
    if (customList) {
        symbols = customList.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    } else {
        const settingsDoc = await Settings.findOne({ userId: 'default' }).lean();
        symbols = (settingsDoc?.symbols || []).filter(Boolean);
    }

    if (!symbols.length) {
        emitFn('agent:log', { level: 'warn', message: 'No coins configured. Add coins in Settings → Coins or set custom coins in Agent settings.' });
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
                emitFn('agent:log', { level: 'info', message: `✓ ${sym} passed — ${res.direction.toUpperCase()} RSI=${res.rsiEntry.toFixed(1)}` });
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
                emitFn('setups:log', { message: `✓ ${sym} passed — ${res.direction.toUpperCase()} RSI=${res.rsiEntry.toFixed(1)}`, level: 'pass' });
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
        rsi5m:     parseFloat(c.rsiEntry.toFixed(1)),
        atr5m:     parseFloat(c.atrEntry.toFixed(6)),
        price:     parseFloat(c.ticker?.lastPrice || 0),
        volume:    parseFloat((parseFloat(c.ticker?.quoteVolume || 0) / 1e6).toFixed(1)),
    }));

    emitFn('setups:done', { candidates: out });
    return out;
}

module.exports = { runScan, runHardFilterScan };
