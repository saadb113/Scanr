import { useEffect, useRef, useState } from 'react';
import { drawModalPrice, drawModalRSI, drawModalMACD, drawObj, segDist } from './modalCanvas';
import { calcPositionSize } from './positionCalc';

const TOOLS = [
  { id: 'brush', key: 'b', title: 'Brush (B)' },
  { id: 'trendline', key: 't', title: 'Trendline (T)' },
  { id: 'eraser', key: 'e', title: 'Eraser (E)' },
];

// Coin-detail modal: hand-rolled canvas price/RSI/MACD charts, a freehand
// drawing-tools layer (brush/trendline/eraser with undo/redo + PNG export,
// persisted per-symbol-per-timeframe via /api/drawings), and an AI-analyze
// panel. Ported from the #modal markup + its JS in public/index.html and
// public/js/app.js (openModal/setupModalCvs/drawModal*/drawing tools/
// runKimiAnalysis/renderAIResult). The duplicate Settings-panel and
// Bybit-terminal overlays that used to live in the same HTML file are NOT
// ported here — Settings and Terminal are already separate React routes;
// this modal links out to them instead (see "More Details" / "Trade on
// Bybit" below).
export default function CoinModal({
  sym, data, timeframe, tfLabel, colors, priceType,
  rsiLen, fastLen, slowLen, signalLen,
  posSettings, starred, onToggleWatchlist,
  initialDrawObjs, onSaveDrawing,
  aiUsage, onAiUsageChange, aiCached, onAiCacheSet, onAiCacheClear,
  hasBybitCreds, navigate, onClose,
}) {
  const priceRef = useRef(null);
  const rsiRef = useRef(null);
  const macdRef = useRef(null);
  const wrapRef = useRef(null);

  const drawObjsRef = useRef(initialDrawObjs || []);
  const [histIdx, setHistIdx] = useState(0);
  const historyRef = useRef([JSON.stringify(initialDrawObjs || [])]);

  const [tool, setTool] = useState('brush');
  const [color, setColor] = useState('#29ffb8');
  const [size, setSize] = useState(3);
  const isDrawingRef = useRef(false);
  const activeCanvasRef = useRef(null); // 'price' | 'rsi' | 'macd'
  const curDrawRef = useRef(null);

  const [aiOpen, setAiOpen] = useState(!!aiCached);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState(aiCached?.result || null);
  const [aiError, setAiError] = useState(null);
  const [aiLimitOpen, setAiLimitOpen] = useState(false);

  const canvasOf = (key) => (key === 'price' ? priceRef.current : key === 'rsi' ? rsiRef.current : macdRef.current);

  function redraw() {
    drawModalPrice(priceRef.current, data, colors, drawObjsRef.current);
    drawModalRSI(rsiRef.current, data, colors, drawObjsRef.current);
    drawModalMACD(macdRef.current, data, colors, drawObjsRef.current);
    if (curDrawRef.current) drawObj(canvasOf(curDrawRef.current.canvas)?.getContext('2d'), curDrawRef.current);
  }

  function sizeCanvases() {
    [priceRef.current, rsiRef.current, macdRef.current].forEach((c) => {
      if (!c || !c.parentElement) return;
      const pr = window.devicePixelRatio || 1;
      const W = c.parentElement.clientWidth - 2, H = c.parentElement.clientHeight - 2;
      c.width = W * pr; c.height = H * pr;
      c.style.width = `${W}px`; c.style.height = `${H}px`;
    });
  }

  useEffect(() => {
    sizeCanvases();
    redraw();
    const onResize = () => { sizeCanvases(); redraw(); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, colors, priceType]);

  useEffect(() => {
    function onKey(e) {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z') { e.preventDefault(); undo(); }
        if (e.key === 'y') { e.preventDefault(); redo(); }
      } else {
        const m = { b: 'brush', t: 'trendline', e: 'eraser' };
        const t = m[e.key.toLowerCase()];
        if (t) setTool(t);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [histIdx]);

  function saveDState() {
    const snapshot = JSON.stringify(drawObjsRef.current);
    historyRef.current = historyRef.current.slice(0, histIdx + 1);
    historyRef.current.push(snapshot);
    setHistIdx(historyRef.current.length - 1);
    onSaveDrawing(drawObjsRef.current);
  }
  function undo() {
    const idx = histIdx > 0 ? histIdx - 1 : 0;
    drawObjsRef.current = JSON.parse(historyRef.current[idx] || '[]');
    setHistIdx(idx);
    redraw();
    onSaveDrawing(drawObjsRef.current);
  }
  function redo() {
    if (histIdx >= historyRef.current.length - 1) return;
    const idx = histIdx + 1;
    drawObjsRef.current = JSON.parse(historyRef.current[idx]);
    setHistIdx(idx);
    redraw();
    onSaveDrawing(drawObjsRef.current);
  }
  function clearDraws() {
    if (!window.confirm('Clear drawings?')) return;
    drawObjsRef.current = [];
    historyRef.current = [JSON.stringify([])];
    setHistIdx(0);
    redraw();
    onSaveDrawing([]);
  }

  function coordsFromEvent(e, canvas) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function eraseAt(x, y, cid) {
    const arr = drawObjsRef.current;
    for (let i = arr.length - 1; i >= 0; i--) {
      const o = arr[i];
      if (o.canvas !== cid) continue;
      if (o.type === 'brush' && o.points.some(([px, py]) => Math.hypot(px - x, py - y) < o.size * 4)) {
        arr.splice(i, 1); redraw(); saveDState(); return;
      }
      if (o.type === 'trendline' && o.points.length === 2) {
        const [[x1, y1], [x2, y2]] = o.points;
        if (segDist(x, y, x1, y1, x2, y2) < o.size * 4) { arr.splice(i, 1); redraw(); saveDState(); return; }
      }
    }
  }

  function startDraw(cid, x, y) {
    isDrawingRef.current = true;
    activeCanvasRef.current = cid;
    if (tool === 'brush') curDrawRef.current = { type: 'brush', points: [[x, y]], color, size, canvas: cid };
    else if (tool === 'trendline') curDrawRef.current = { type: 'trendline', points: [[x, y], [x, y]], color, size, canvas: cid };
    else if (tool === 'eraser') eraseAt(x, y, cid);
  }
  function moveDraw(x, y) {
    if (!isDrawingRef.current || !curDrawRef.current) {
      if (tool === 'eraser' && isDrawingRef.current) eraseAt(x, y, activeCanvasRef.current);
      return;
    }
    if (tool === 'brush') curDrawRef.current.points.push([x, y]);
    else if (tool === 'trendline') curDrawRef.current.points[1] = [x, y];
    redraw();
  }
  function stopDraw() {
    if (isDrawingRef.current && curDrawRef.current) {
      drawObjsRef.current = [...drawObjsRef.current, curDrawRef.current];
      curDrawRef.current = null;
      saveDState();
    }
    isDrawingRef.current = false;
  }

  function canvasHandlers(cid) {
    return {
      onMouseDown: (e) => { const c = canvasOf(cid); const [x, y] = coordsFromEvent(e, c); startDraw(cid, x, y); },
      onMouseMove: (e) => { const c = canvasOf(cid); const [x, y] = coordsFromEvent(e, c); moveDraw(x, y); },
      onMouseUp: stopDraw,
      onMouseLeave: stopDraw,
      onTouchStart: (e) => { e.preventDefault(); const t = e.touches[0]; const c = canvasOf(cid); const [x, y] = coordsFromEvent(t, c); startDraw(cid, x, y); },
      onTouchMove: (e) => { e.preventDefault(); const t = e.touches[0]; const c = canvasOf(cid); const [x, y] = coordsFromEvent(t, c); moveDraw(x, y); },
      onTouchEnd: stopDraw,
    };
  }

  function exportBoth() {
    const priceCvs = priceRef.current, rsiCvs = rsiRef.current, macdCvs = macdRef.current;
    if (!priceCvs || !rsiCvs || !macdCvs) return;
    const pr = window.devicePixelRatio || 1;
    const W = priceCvs.width / pr, pH = priceCvs.height / pr, rH = rsiCvs.height / pr, mH = macdCvs.height / pr;
    const totalH = pH + rH + mH + 16;
    const cv = document.createElement('canvas');
    cv.width = W * pr; cv.height = totalH * pr;
    const ctx = cv.getContext('2d'); ctx.scale(pr, pr);
    ctx.fillStyle = '#0f1117'; ctx.fillRect(0, 0, W, totalH);
    ctx.drawImage(priceCvs, 0, 0, W, pH, 0, 0, W, pH);
    ctx.drawImage(rsiCvs, 0, 0, W, rH, 0, pH + 8, W, rH);
    ctx.drawImage(macdCvs, 0, 0, W, mH, 0, pH + rH + 16, W, mH);
    const a = document.createElement('a');
    a.download = `${sym}_Price_RSI_MACD.png`;
    a.href = cv.toDataURL();
    a.click();
  }

  // ── Infobar ──────────────────────────────────────────────────
  const rsiLast = data?.rsi?.length ? data.rsi[data.rsi.length - 1] : null;
  const histLast = data?.hist?.length ? data.hist[data.hist.length - 1] : null;
  const macdLast = data?.macd?.length ? data.macd[data.macd.length - 1] : null;
  const signalLast = data?.signal?.length ? data.signal[data.signal.length - 1] : null;
  const dp = macdLast != null ? (Math.abs(macdLast) > 10 ? 2 : Math.abs(macdLast) > 1 ? 4 : 6) : 4;
  const rsiColor = rsiLast != null ? (rsiLast >= 70 ? colors.rsiOB : rsiLast <= 30 ? colors.rsiOS : colors.rsi) : colors.rsi;

  let posSizeStr = null;
  const capital = parseFloat(posSettings.capital) || 0;
  if (capital > 0 && data?.ohlcFull?.length >= 14 && data.price) {
    const recent = data.ohlcFull.slice(-14);
    const atr = recent.reduce((acc, c) => acc + (c[1] - c[2]), 0) / 14;
    if (atr > 0) {
      const riskPct = parseFloat(posSettings.riskPerTrade ?? posSettings.risk) || 1;
      const riskAmt = capital * (riskPct / 100);
      const qty = riskAmt / atr;
      const posValue = qty * data.price;
      posSizeStr = posValue >= 10000 ? `$${(posValue / 1000).toFixed(1)}K` : `$${posValue.toFixed(2)}`;
    }
  }

  // ── AI analyze ───────────────────────────────────────────────
  function buildPrompt() {
    const ohlcAll = data.ohlcFull || data.ohlc;
    const rsiAll = data.rsiArr || data.rsi;
    const macdAll = data.macdArr || data.macd;
    const signalAll = data.signalArr || data.signal;
    const histAll = data.histArr || data.hist;
    const price = data.price;
    const f = data.flags || {};

    const alignLen = Math.min(ohlcAll.length, rsiAll.length, macdAll.length);
    const ohlcAligned = ohlcAll.slice(-alignLen);
    const rsiAligned = rsiAll.slice(-alignLen);
    const macdAligned = macdAll.slice(-alignLen);
    const signalAligned = signalAll.slice(-alignLen);
    const histAligned = histAll.slice(-alignLen);
    const dpP = price >= 1000 ? 2 : price >= 1 ? 4 : 6;

    const candleTable = ohlcAligned.map((c, i) => {
      const r = rsiAligned[i] != null ? rsiAligned[i].toFixed(2) : '-';
      const m = macdAligned[i] != null ? macdAligned[i].toFixed(6) : '-';
      const sg = signalAligned[i] != null ? signalAligned[i].toFixed(6) : '-';
      const h = histAligned[i] != null ? histAligned[i].toFixed(6) : '-';
      return `${i + 1}\t${c[0].toFixed(dpP)}\t${c[1].toFixed(dpP)}\t${c[2].toFixed(dpP)}\t${c[3].toFixed(dpP)}\t${r}\t${m}\t${sg}\t${h}`;
    }).join('\n');

    const lastRSI = rsiAll[rsiAll.length - 1];
    const lastMACD = macdAll[macdAll.length - 1];
    const lastSignal = signalAll[signalAll.length - 1];
    const lastHist = histAll[histAll.length - 1];
    const allCloses = ohlcAll.map((c) => c[3]);
    const allHighs = ohlcAll.map((c) => c[1]);
    const allLows = ohlcAll.map((c) => c[2]);
    const highestPrice = Math.max(...allHighs);
    const lowestPrice = Math.min(...allLows);
    const avgClose = allCloses.reduce((a, b) => a + b, 0) / allCloses.length;
    const avgRSI = rsiAll.reduce((a, b) => a + b, 0) / rsiAll.length;
    const rsiTrend = rsiAll.slice(-5);
    const rsiTrendDir = rsiTrend[rsiTrend.length - 1] > rsiTrend[0] ? 'Rising' : 'Falling';
    const histLast5 = histAll.slice(-5);
    const histTrend = histLast5[histLast5.length - 1] > histLast5[0] ? 'Expanding Bullish'
      : histLast5[histLast5.length - 1] < histLast5[0] ? 'Expanding Bearish' : 'Flat';

    const signals = [];
    if (f.ob) signals.push('RSI Overbought (≥70)');
    if (f.os) signals.push('RSI Oversold (≤30)');
    if (f.mxBull) signals.push('MACD Bullish Histogram Cross');
    if (f.mxBear) signals.push('MACD Bearish Histogram Cross');
    if (f.rdivBull) signals.push('RSI Bullish Divergence (price made lower low, RSI made higher low)');
    if (f.rdivBear) signals.push('RSI Bearish Divergence (price made higher high, RSI made lower high)');
    if (f.mdivBull) signals.push('MACD Bullish Divergence');
    if (f.mdivBear) signals.push('MACD Bearish Divergence');
    if (f.rsiGolden) signals.push('RSI Golden Cross (RSI crossed above EMA-9)');
    if (f.rsiDeath) signals.push('RSI Death Cross (RSI crossed below EMA-9)');

    const dpFmt = (v) => v.toFixed(price >= 1000 ? 2 : price >= 1 ? 4 : 6);

    return `You are an expert crypto futures technical analyst. Analyze the complete dataset below for ${sym} on the ${tfLabel} timeframe and provide a precise, high-confidence trade recommendation.

═══ MARKET OVERVIEW ═══
Symbol: ${sym} | Timeframe: ${tfLabel} | Current Price: ${price} | Total Candles: ${alignLen}
Indicator Settings — RSI: ${rsiLen} | MACD Fast/Slow/Signal: ${fastLen}/${slowLen}/${signalLen}

═══ PRICE STATS (all ${alignLen} bars) ═══
Highest High: ${dpFmt(highestPrice)} | Lowest Low: ${dpFmt(lowestPrice)} | Average Close: ${dpFmt(avgClose)}

═══ CURRENT INDICATORS (latest bar) ═══
RSI(${rsiLen}): ${lastRSI.toFixed(2)} — last 5 bars: ${rsiTrendDir} | avg: ${avgRSI.toFixed(2)}
MACD: ${lastMACD.toFixed(6)} | Signal: ${lastSignal.toFixed(6)} | Hist: ${lastHist.toFixed(6)} — momentum: ${histTrend}
MACD vs Signal: ${lastMACD > lastSignal ? 'MACD ABOVE Signal (Bullish)' : 'MACD BELOW Signal (Bearish)'}

═══ ACTIVE SCANNER SIGNALS ═══
${signals.length ? signals.map((s) => `• ${s}`).join('\n') : '• No special signals detected'}

═══ FULL CANDLE DATA — ALL ${alignLen} BARS ═══
Format: #  Open  High  Low  Close  RSI  MACD  Signal  Histogram
${candleTable}

═══ YOUR TASK ═══
Using ALL the data above, identify key support/resistance levels and provide a trade recommendation.
Respond ONLY in this exact JSON format, no markdown, no extra text:
{
  "direction": "LONG" or "SHORT" or "NEUTRAL",
  "entry": <number>,
  "tp": <number>,
  "sl": <number>,
  "rr": "<string e.g. 1:2.3>",
  "confidence": "<LOW / MEDIUM / HIGH>",
  "reasoning": "<4-6 sentences>"
}`;
  }

  function getClientTimezone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
  }

  async function runAiAnalysis() {
    if (!data) { window.alert('No data loaded for this coin yet. Wait for it to load.'); return; }
    if (aiUsage && !aiUsage.isPremium && Number(aiUsage.used || 0) >= Number(aiUsage.limit || 3)) {
      setAiLimitOpen(true);
      return;
    }
    setAiOpen(true);
    setAiLoading(true);
    setAiError(null);
    try {
      const prompt = buildPrompt();
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, timezone: getClientTimezone() }),
      });
      const resData = await res.json();
      if (res.status === 429 || resData?.error === 'limit_reached') {
        setAiLimitOpen(true);
        throw new Error(resData.message || 'Daily AI analysis limit reached');
      }
      if (!res.ok) throw new Error(resData.error || `Server error ${res.status}`);
      // /api/ai/analyze always responds HTTP 200, even on failure (e.g. no
      // API key configured) — it signals failure via `ok:false` in the body
      // instead (confirmed in server.js). Same gap useAiAnalysis.js already
      // handles for Terminal/Coin-Detail; without this check a missing key
      // would fall through to JSON.parse('') and show a confusing
      // "Unexpected end of JSON input" instead of the real reason.
      if (resData?.ok === false) throw new Error(resData.error || 'AI request failed');
      const cleaned = (resData.result || '').replace(/```json|```/gi, '').trim();
      const parsed = JSON.parse(cleaned);
      const analyzedAt = new Date().toLocaleString();
      setAiResult(parsed);
      onAiCacheSet({ result: parsed, price: data.price, analyzedAt });
      if (aiUsage && !aiUsage.isPremium) onAiUsageChange({ ...aiUsage, used: Number(aiUsage.used || 0) + 1 });
    } catch (e) {
      setAiError(e.message);
    } finally {
      setAiLoading(false);
    }
  }

  function closeAiPanel() {
    onAiCacheClear();
    setAiOpen(false);
    setAiResult(null);
    setAiError(null);
  }

  function tradeOnBybit(dir, entry, sl, tp, maxLev) {
    if (!hasBybitCreds) {
      try { sessionStorage.setItem('settings_tab', 'bybit'); } catch { /* ignore */ }
      navigate('/settings');
      return;
    }
    try { sessionStorage.setItem('bybit_prefill', JSON.stringify({ sym, dir, entry, sl, tp, maxLev })); } catch { /* ignore */ }
    navigate('/terminal');
  }

  function openCoinDetail() {
    onClose();
    navigate(`/coin-detail?sym=${encodeURIComponent(sym)}`);
  }

  const usageDisabled = aiUsage && !aiUsage.isPremium && Number(aiUsage.used || 0) >= Number(aiUsage.limit || 3);
  const usageLabel = aiUsage
    ? (aiUsage.isPremium ? 'AI ∞' : `${Math.min(Number(aiUsage.used || 0), Number(aiUsage.limit || 3))}/${aiUsage.limit || 3}`)
    : null;

  const coinMaxLev = 100; // live Bybit max-leverage lookup intentionally skipped — see positionCalc.js note
  const posCard = (aiResult && aiResult.direction !== 'NEUTRAL' && aiResult.entry && aiResult.sl)
    ? calcPositionSize(aiResult.entry, aiResult.sl, aiResult.tp, posSettings, coinMaxLev)
    : null;

  return (
    <div className="modal open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-content" ref={wrapRef}>
        <div className="modal-header">
          <h2>{sym}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              type="button" onClick={openCoinDetail} title="Open detailed chart & trade"
              style={{ background: '#0d1a0d', border: '1px solid #22c55e', borderRadius: 5, padding: '0.2rem 0.6rem', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', color: '#22c55e', whiteSpace: 'nowrap' }}
            ><i className="fa-solid fa-magnifying-glass" /> More Details</button>
            <button
              type="button" className="modal-wl-btn" onClick={() => onToggleWatchlist(sym)}
              title={starred ? 'Remove from Watchlist' : 'Add to Watchlist'}
              style={{ background: 'none', border: `1px solid ${starred ? '#ffd700' : '#252d3d'}`, borderRadius: 6, padding: '0.2rem 0.55rem', cursor: 'pointer', fontSize: '1rem', color: starred ? '#ffd700' : '#3a4560', transition: 'all 0.15s' }}
            >★</button>
            <button type="button" className="modal-close" onClick={onClose}>&times;</button>
          </div>
        </div>

        <div className="modal-infobar">
          <span className="inf">Price: <span className="val">{data ? data.price.toFixed(4) : '—'}</span></span>
          <span className="inf">RSI: <span className="val" style={{ color: rsiColor }}>{rsiLast != null ? rsiLast.toFixed(2) : '—'}</span></span>
          <span className="inf">MACD: <span className="val" style={{ color: '#63b3ed' }}>{macdLast != null ? macdLast.toFixed(dp) : '—'}</span></span>
          <span className="inf">Signal: <span className="val" style={{ color: '#f6ad55' }}>{signalLast != null ? signalLast.toFixed(dp) : '—'}</span></span>
          <span className="inf">Hist: <span className="val" style={{ color: histLast != null ? (histLast >= 0 ? colors.bull : colors.bear) : undefined }}>{histLast != null ? histLast.toFixed(dp) : '—'}</span></span>
          {posSizeStr && <span className="inf">Pos: <span className="val" style={{ color: '#f59e0b' }}>{posSizeStr}</span></span>}
        </div>

        <div className="modal-toolbar">
          <div style={{ display: 'flex', gap: 4 }}>
            {TOOLS.map((t) => (
              <button
                key={t.id} type="button" className={`tool-btn${tool === t.id ? ' active' : ''}`} title={t.title}
                onClick={() => setTool(t.id)}
              >
                {t.id === 'brush' && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" /><line x1="16" y1="8" x2="2" y2="22" /><line x1="17.5" y1="15" x2="9" y2="15" /></svg>}
                {t.id === 'trendline' && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="20" x2="21" y2="4" /></svg>}
                {t.id === 'eraser' && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 21h10" /><path d="M3 12l2-2 7.5-7.5 5 5L5 17l-2-2z" /></svg>}
              </button>
            ))}
          </div>
          <div className="tb-sep" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="range" min="1" max="20" value={size} onChange={(e) => setSize(+e.target.value)} style={{ width: 60, accentColor: '#29ffb8' }} />
            <span style={{ fontSize: 12, color: '#29ffb8', minWidth: 14 }}>{size}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 26, height: 26, borderRadius: 4, border: '1px solid #252d3d', cursor: 'pointer' }} />
          </div>
          <div className="tb-actions">
            <button type="button" className="tool-btn" title="Undo (Ctrl+Z)" disabled={histIdx <= 0} onClick={undo}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></svg>
            </button>
            <button type="button" className="tool-btn" title="Redo (Ctrl+Y)" disabled={histIdx >= historyRef.current.length - 1} onClick={redo}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3-2.7" /></svg>
            </button>
            <button type="button" className="btn-sm btn-danger" onClick={clearDraws}>Clear</button>
            <button type="button" className="btn-sm btn-export" onClick={exportBoth}>Export</button>
            <button type="button" className="ai-analyze-btn" title="Analyze with AI" disabled={usageDisabled} onClick={runAiAnalysis}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" /></svg>
              Analyze with AI
              {usageLabel && <div style={{ color: '#fff', fontSize: 11 }}>{usageLabel}</div>}
            </button>
          </div>
        </div>

        <div className="modal-charts-wrap">
          <div className={`ai-panel${aiOpen ? ' open' : ''}`}>
            <div className="ai-panel-header">
              <div className="ai-panel-title">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2a10 10 0 1 0 10 10" /><path d="M12 8v4l3 3" /></svg>
                AI Analysis
              </div>
              <button type="button" className="ai-close-panel" onClick={closeAiPanel}>&times;</button>
            </div>
            <div className="ai-content">
              {aiLoading && <div className="ai-loading"><div className="ai-spinner" />AI is analyzing {sym} with full candle data…</div>}
              {!aiLoading && aiError && <div className="ai-error">⚠ {aiError}</div>}
              {!aiLoading && !aiError && aiResult && (
                <div className="ai-result">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
                    <div className={`ai-direction-badge ${aiResult.direction === 'LONG' ? 'long' : aiResult.direction === 'SHORT' ? 'short' : 'neutral'}`}>
                      {aiResult.direction === 'LONG' ? '▲' : aiResult.direction === 'SHORT' ? '▼' : '◆'} {aiResult.direction}
                      <span style={{ fontSize: '0.72rem', fontWeight: 500, opacity: 0.75 }}> {sym} · {tfLabel}</span>
                    </div>
                    {aiResult.confidence && (
                      <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid #44444488', borderRadius: 6, padding: '0.25rem 0.65rem', fontSize: 11, fontWeight: 700 }}>
                        Confidence: {aiResult.confidence}
                      </div>
                    )}
                  </div>
                  <div className="ai-metrics" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
                    <div className="ai-metric-card"><div className="ai-metric-label">Entry</div><div className="ai-metric-val">{aiResult.entry ?? '—'}</div></div>
                    <div className="ai-metric-card"><div className="ai-metric-label">Stop Loss</div><div className="ai-metric-val sl">{aiResult.sl ?? '—'}</div></div>
                    <div className="ai-metric-card"><div className="ai-metric-label">Take Profit</div><div className="ai-metric-val tp">{aiResult.tp ?? '—'}</div></div>
                    <div className="ai-metric-card"><div className="ai-metric-label">R : R</div><div className="ai-metric-val rr">{aiResult.rr || '—'}</div></div>
                  </div>
                  {posCard && (
                    <div className="pos-calc-card">
                      <div className="pos-calc-title">Position Sizing · {posCard.isSpot ? 'Spot' : `${posCard.leverage}x`} Leverage</div>
                      <div className="pos-calc-grid">
                        <div className="pos-calc-item highlight full">
                          <div className="pos-calc-label">Position Size (enter this much)</div>
                          <div className="pos-calc-val gold">{posCard.fmtP(posCard.posValue)}</div>
                        </div>
                        <div className="pos-calc-item highlight">
                          <div className="pos-calc-label">Required Margin</div>
                          <div className="pos-calc-val blue">{posCard.fmtP(posCard.margin)}</div>
                        </div>
                        <div className="pos-calc-item highlight">
                          <div className="pos-calc-label">Max Loss</div>
                          <div className="pos-calc-val red">-{posCard.fmtP(posCard.netRisk)}</div>
                        </div>
                        {posCard.profitRaw != null && (
                          <>
                            <div className="pos-calc-item">
                              <div className="pos-calc-label">Est. Profit (at TP)</div>
                              <div className="pos-calc-val green">+{posCard.fmtP(posCard.profitRaw)}</div>
                            </div>
                            <div className="pos-calc-item">
                              <div className="pos-calc-label">Real R:R</div>
                              <div className="pos-calc-val blue">1 : {posCard.rrActual}</div>
                            </div>
                          </>
                        )}
                      </div>
                      <div className="pos-calc-warn">${posCard.capital.toLocaleString()} capital · {posCard.riskPct}% risk per trade</div>
                    </div>
                  )}
                  <div className="ai-reasoning">{aiResult.reasoning}</div>
                  {aiResult.direction !== 'NEUTRAL' && aiResult.entry && aiResult.sl && (
                    <button
                      type="button"
                      onClick={() => tradeOnBybit(aiResult.direction, parseFloat(aiResult.entry) || 0, parseFloat(aiResult.sl) || 0, parseFloat(aiResult.tp) || 0, coinMaxLev)}
                      style={{ width: '100%', padding: '0.65rem', background: 'linear-gradient(135deg,#92400e,var(--accent-amber))', color: '#0f0700', border: 'none', borderRadius: 9, fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}
                    ><i className="fa-solid fa-rocket" /> Trade on Bybit · {coinMaxLev}x Max Lev</button>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="modal-charts">
            <div className="chart-pane price-pane">
              <span className="pane-label">Price</span>
              <canvas ref={priceRef} {...canvasHandlers('price')} />
            </div>
            <div className="divider" />
            <div className="chart-pane rsi-pane">
              <span className="pane-label">RSI</span>
              <canvas ref={rsiRef} {...canvasHandlers('rsi')} />
            </div>
            <div className="divider" />
            <div className="chart-pane macd-pane">
              <span className="pane-label">MACD</span>
              <canvas ref={macdRef} {...canvasHandlers('macd')} />
            </div>
          </div>
        </div>
      </div>

      {aiLimitOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 3200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setAiLimitOpen(false)}>
          <div style={{ width: 'min(420px,95vw)', background: '#121826', border: '1px solid #2b3242', borderRadius: 12, padding: '18px 16px', color: '#dde4f0' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 10 }}><i className="fa-solid fa-robot" /> Daily Limit Reached</div>
            <div style={{ fontSize: 13, color: '#9aa3b5', lineHeight: 1.65, marginBottom: 14 }}>
              Free users get 3 AI analyses per day.<br /><br />Your limit resets at midnight (your timezone).<br /><br />Upgrade to Premium for unlimited AI analysis 🚀
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
              <button type="button" onClick={() => navigate('/pricing')} style={{ padding: '11px 12px', background: '#00e5a0', color: '#041017', border: 'none', borderRadius: 8, fontWeight: 800, cursor: 'pointer' }}><i className="fa-solid fa-rocket" /> Upgrade to Premium</button>
              <button type="button" onClick={() => setAiLimitOpen(false)} style={{ padding: '10px 12px', background: '#1b2433', color: '#c9d1e2', border: '1px solid #2f3a4d', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>Maybe Later</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
