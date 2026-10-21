import { useCallback, useState } from 'react';
import { api } from '../api/client';
import { fetchBinanceKlines, TF_TO_BINANCE, TF_LABELS } from '../utils/bybit';

function calcRSI(arr, p = 14) {
  const out = new Array(arr.length).fill(null);
  if (arr.length < p + 1) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = arr[i] - arr[i - 1]; if (d > 0) g += d; else l -= d; }
  let ag = g / p, al = l / p;
  out[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = p + 1; i < arr.length; i++) {
    const d = arr[i] - arr[i - 1];
    ag = (ag * (p - 1) + Math.max(d, 0)) / p;
    al = (al * (p - 1) + Math.max(-d, 0)) / p;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}
function calcEMA(v, p) {
  const k = 2 / (p + 1), e = v.map(() => null), f = v.findIndex((x) => x != null);
  if (f < 0) return e;
  e[f] = v[f];
  for (let i = f + 1; i < v.length; i++) e[i] = v[i] * k + e[i - 1] * (1 - k);
  return e;
}
function calcMACD(c, f = 12, s = 26, sig = 9) {
  const ef = calcEMA(c, f), es = calcEMA(c, s);
  const ml = c.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
  const sl = calcEMA(ml, sig);
  return { macd: ml, signal: sl };
}

// Shared AI-analysis logic for Terminal's sidebar panel and Coin-Detail's
// drawer. Ported from bytRunAI()/bytFetchAIUsage() (terminal.html) — nearly
// byte-identical to coin-detail.html's cdRunAI(), so unified here.
//
// Known backend gap: GET /api/analysis/usage (daily free-tier AI usage
// counter) does not exist in server.js — confirmed by grep, only
// /api/ai/settings, /api/ai/test and /api/ai/analyze exist. POST
// /api/ai/analyze itself also has no usage-limiting logic (always succeeds
// for any authenticated user, premium or not). This means the "3/day free"
// messaging in the legacy UI was already silently inert in production: the
// usage fetch failed, _bytAIUsage stayed null, and the limit check
// (`if (_bytAIUsage && ...)`) never tripped. We reproduce that exact
// behavior rather than inventing a usage-limiting backend: fetchUsage()
// swallows the 404 and leaves `usage` null, so the UI simply never shows a
// counter or blocks a request, same as before.
export function useAiAnalysis() {
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const fetchUsage = useCallback(async () => {
    try {
      const d = await api.get('/api/analysis/usage');
      setUsage(d);
      return d;
    } catch {
      return null;
    }
  }, []);

  const run = useCallback(async (symbol, tf) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      if (usage && !usage.isPremium && Number(usage.used || 0) >= Number(usage.limit || 3)) {
        const limitErr = new Error('Daily AI analysis limit reached');
        limitErr.limitReached = true;
        throw limitErr;
      }
      const interval = TF_TO_BINANCE[tf] || tf;
      const klData = await fetchBinanceKlines(symbol, interval, 100);
      if (!Array.isArray(klData) || !klData.length) throw new Error(`Failed to fetch klines for ${symbol}`);

      const ohlcv = klData.map((c) => [+c[1], +c[2], +c[3], +c[4], +c[5]]);
      const closes = ohlcv.map((c) => c[3]);
      const price = closes[closes.length - 1];
      const rsiAll = calcRSI(closes);
      const { macd: macdAll, signal: signalAll } = calcMACD(closes);
      const n = 50;
      const dp = price >= 1000 ? 2 : price >= 1 ? 4 : 6;
      const candleTable = ohlcv.slice(-n).map((c, i) => {
        const ri = rsiAll.length - n + i, mi = macdAll.length - n + i;
        return `${i + 1}\t${c[0].toFixed(dp)}\t${c[1].toFixed(dp)}\t${c[2].toFixed(dp)}\t${c[3].toFixed(dp)}\t${rsiAll[ri] != null ? rsiAll[ri].toFixed(2) : '-'}\t${macdAll[mi] != null ? macdAll[mi].toFixed(6) : '-'}\t${signalAll[mi] != null ? signalAll[mi].toFixed(6) : '-'}`;
      }).join('\n');
      const lastRSI = rsiAll.filter((v) => v != null).at(-1) || 0;
      const lastMACD = macdAll.filter((v) => v != null).at(-1) || 0;
      const lastSig = signalAll.filter((v) => v != null).at(-1) || 0;
      const tfLabel = TF_LABELS[tf] || tf;

      const prompt = `You are an expert crypto futures technical analyst. Analyze ${symbol} on the ${tfLabel} timeframe.
Symbol: ${symbol} | TF: ${tfLabel} | Price: ${price} | RSI(14): ${lastRSI.toFixed(2)} | MACD: ${lastMACD.toFixed(6)} | Signal: ${lastSig.toFixed(6)}

Last ${n} candles (# Open High Low Close RSI MACD Signal):
${candleTable}

Respond ONLY in this exact JSON (no markdown):
{"direction":"LONG or SHORT or NEUTRAL","entry":<number>,"tp":<number>,"sl":<number>,"rr":"<e.g. 1:2.3>","confidence":"LOW or MEDIUM or HIGH","reasoning":"<3-5 sentences>"}`;

      const aiData = await api.post('/api/ai/analyze', { prompt });
      if (aiData?.error === 'limit_reached') {
        const limitErr = new Error(aiData.message || 'Daily AI analysis limit reached');
        limitErr.limitReached = true;
        throw limitErr;
      }
      if (aiData?.ok === false) throw new Error(aiData.error || 'AI request failed');

      const raw = aiData.result || '';
      let parsed;
      try { parsed = JSON.parse(raw.replace(/```json|```/gi, '').trim()); } catch { throw new Error('Could not parse AI response'); }

      setResult(parsed);
      setUsage((u) => (u && !u.isPremium ? { ...u, used: Number(u.used || 0) + 1 } : u));
      return parsed;
    } catch (e) {
      setError(e);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [usage]);

  return { usage, fetchUsage, loading, result, error, run, setResult };
}
