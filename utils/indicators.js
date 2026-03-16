'use strict';

/**
 * utils/indicators.js — Single source of truth for all technical indicators.
 * Both coinScanner.js and strategyBot.js import from here to guarantee
 * identical calculation logic and matching values.
 *
 * All indicator functions operate on CLOSED candles only.
 * Callers must slice off the last open candle before passing data here:
 *   candles = candles.slice(0, -1)
 *
 * Candle fetch uses Binance Futures so both scanner and bot operate on the
 * same underlying price data.
 */

// ── EMA / SMA Series ──────────────────────────────────────────

/**
 * EMA series seeded from values[0] (matches TradingView default).
 * Returns an array of the same length — every index has a value.
 */
function calcEMASeries(values, period) {
    if (!values.length) return [];
    const k   = 2 / (period + 1);
    const out = [values[0]];
    for (let i = 1; i < values.length; i++) {
        out.push(values[i] * k + out[i - 1] * (1 - k));
    }
    return out;
}

/**
 * SMA series. Returns null for indices before the first full window.
 */
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

// ── RSI ──────────────────────────────────────────────────────

/**
 * RSI using Wilder's smoothing (same as TradingView).
 * Returns 50 if not enough data.
 */
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

// ── MACD ─────────────────────────────────────────────────────

/**
 * MACD — returns current and previous hist values for cross detection.
 */
function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
    const ema12  = calcEMASeries(closes, fast);
    const ema26  = calcEMASeries(closes, slow);
    const macdL  = ema12.map((v, i) => v - ema26[i]);
    const sigSer = calcEMASeries(macdL, signal);
    const hist   = macdL.map((v, i) => v - sigSer[i]);
    const n = macdL.length;
    return {
        macd:     macdL[n - 1],
        signal:   sigSer[n - 1],
        hist:     hist[n - 1],
        macdPrev: n >= 2 ? macdL[n - 2] : macdL[n - 1],
        histPrev: n >= 2 ? hist[n - 2]  : hist[n - 1],
    };
}

// ── ATR ──────────────────────────────────────────────────────

/**
 * ATR using Wilder's smoothing (same as TradingView).
 * candles must have { high, low, close }.
 */
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

// ── Bollinger Bands ──────────────────────────────────────────

/**
 * Bollinger Bands — upper, mid, lower. Returns nulls if not enough data.
 */
function calcBollingerBands(closes, period = 20, stdDev = 2) {
    const smaS = calcSMASeries(closes, period);
    const mid  = smaS[smaS.length - 1];
    if (mid == null) return { upper: null, mid: null, lower: null };
    const slice    = closes.slice(-period);
    const variance = slice.reduce((s, v) => s + (v - mid) ** 2, 0) / period;
    const sd       = Math.sqrt(variance);
    return { upper: mid + stdDev * sd, mid, lower: mid - stdDev * sd };
}

// ── Stochastic ───────────────────────────────────────────────

/**
 * Stochastic %K/%D with crossover values.
 * candles must have { high, low, close }.
 */
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

// ── Volume ratio ─────────────────────────────────────────────

/**
 * Volume ratio: last candle volume / average of previous `period` candle volumes.
 * candles must have { volume }.
 */
function calcVolumeRatio(candles, period = 20) {
    if (candles.length < 2) return 0;
    const vols   = candles.map(c => c.volume);
    const avg    = vols.slice(-period - 1, -1).reduce((a, b) => a + b, 0) / Math.min(period, vols.length - 1);
    return avg > 0 ? vols[vols.length - 1] / avg : 0;
}

// ── Binance Futures candle fetch ─────────────────────────────

/**
 * Fetch OHLCV candles from Binance Futures (fapi).
 * interval uses Binance format: '1m','5m','15m','1h','4h','1d', etc.
 * Returns candles sorted oldest-first.
 */
async function fetchCandles(sym, interval, limit) {
    const r = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${interval}&limit=${limit}`);
    if (!r.ok) throw new Error(`Candles ${sym}/${interval}: HTTP ${r.status}`);
    return (await r.json()).map(c => ({
        time: c[0], open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +c[5],
    }));
}

module.exports = {
    calcEMASeries,
    calcSMASeries,
    calcRSI,
    calcMACD,
    calcATR,
    calcBollingerBands,
    calcStochastic,
    calcVolumeRatio,
    fetchCandles,
};
