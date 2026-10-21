// Coin-modal chart canvas drawing (price candles + EMA9/21, RSI, MACD) and
// the freehand drawing-tool overlay — ported verbatim from public/js/app.js
// (drawModalPrice/drawModalRSI/drawModalMACD/drawObj/segDist).
import { ema } from '../../utils/scannerIndicators';

export function drawModalPrice(canvas, data, colors, drawObjs) {
  if (!canvas || !data || !data.ohlc || data.ohlc.length < 2) return;
  const ctx = canvas.getContext('2d');
  const pr = window.devicePixelRatio || 1;
  const W = canvas.width / pr, H = canvas.height / pr;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(pr, pr);
  ctx.fillStyle = '#0f1117'; ctx.fillRect(0, 0, W, H);

  const ohlc = data.ohlc;
  const n = ohlc.length;
  const mL = 14, mR = 54, mT = 14, mB = 22;
  const cW = W - mL - mR, cH = H - mT - mB;

  const allH = ohlc.map((c) => c[1]), allL = ohlc.map((c) => c[2]);
  const pMin = Math.min(...allL), pMax = Math.max(...allH);
  const pRng = pMax - pMin || pMin * 0.001;
  const pad = pRng * 0.06;
  const lo = pMin - pad, hi = pMax + pad, rng = hi - lo;
  const toY = (v) => mT + cH - ((v - lo) / rng) * cH;

  const candleW = Math.max(1.5, (cW / n) * 0.7);
  const sX = cW / n;

  ctx.font = '10px Inter,sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#4a5568';
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const v = lo + (rng / steps) * i;
    const gy = toY(v);
    ctx.beginPath(); ctx.strokeStyle = '#1e2535'; ctx.lineWidth = 0.5;
    ctx.moveTo(mL, gy); ctx.lineTo(mL + cW, gy); ctx.stroke();
    let label;
    if (v >= 1000) label = v.toFixed(1); else if (v >= 1) label = v.toFixed(3); else label = v.toFixed(6);
    ctx.fillText(label, mL + cW + 4, gy + 4);
  }

  const closes = ohlc.map((c) => c[3]);
  const ema9 = ema(closes, 9), ema21 = ema(closes, 21);
  const ema9off = n - ema9.length, ema21off = n - ema21.length;
  [[ema9, ema9off, '#f6ad55'], [ema21, ema21off, '#a78bfa']].forEach(([arr, off, col]) => {
    if (!arr.length) return;
    ctx.beginPath(); ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.lineJoin = 'round'; ctx.globalAlpha = 0.8;
    for (let i = 0; i < arr.length; i++) {
      const px = mL + (i + off) * sX + sX / 2, py = toY(arr[i]);
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  });

  for (let i = 0; i < n; i++) {
    const [o, h, l, c] = ohlc[i];
    const bull = c >= o;
    const px = mL + i * sX + sX / 2;
    const cy1 = toY(Math.max(o, c)), cy2 = toY(Math.min(o, c));
    const bodyH = Math.max(1, cy2 - cy1);
    ctx.strokeStyle = bull ? colors.bull : colors.bear;
    ctx.lineWidth = Math.max(0.8, candleW * 0.12); ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.moveTo(px, toY(h)); ctx.lineTo(px, toY(l)); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = bull ? colors.bull : colors.bear; ctx.globalAlpha = 0.85;
    ctx.fillRect(px - candleW / 2, cy1, candleW, bodyH); ctx.globalAlpha = 1;
  }

  const lastClose = closes[closes.length - 1];
  const priceY = toY(lastClose);
  ctx.setLineDash([4, 3]); ctx.strokeStyle = '#e5e9f2'; ctx.lineWidth = 0.7; ctx.globalAlpha = 0.35;
  ctx.beginPath(); ctx.moveTo(mL, priceY); ctx.lineTo(mL + cW, priceY); ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha = 1;

  let prLabel;
  if (lastClose >= 1000) prLabel = lastClose.toFixed(2); else if (lastClose >= 1) prLabel = lastClose.toFixed(4); else prLabel = lastClose.toFixed(6);
  ctx.font = 'bold 11px Inter,monospace'; ctx.textAlign = 'left';
  const lblW = ctx.measureText(prLabel).width + 8;
  ctx.fillStyle = '#29ffb8'; ctx.fillRect(mL + cW + 2, priceY - 8, lblW, 16);
  ctx.fillStyle = '#0f1117'; ctx.fillText(prLabel, mL + cW + 6, priceY + 4);

  ctx.font = '10px Inter,sans-serif'; ctx.textAlign = 'left';
  [[ema9, '#f6ad55', 'EMA 9'], [ema21, '#a78bfa', 'EMA 21']].forEach(([arr, col, lbl], idx) => {
    if (!arr.length) return;
    const lx = mL + 4 + idx * 70, ly = mT + cH + mB - 6;
    ctx.fillStyle = col; ctx.fillRect(lx, ly - 5, 14, 2);
    ctx.fillStyle = '#6b7897'; ctx.fillText(lbl, lx + 18, ly);
  });

  (drawObjs || []).filter((o) => o.canvas === 'price').forEach((o) => drawObj(ctx, o));
}

export function drawModalRSI(canvas, data, colors, drawObjs) {
  if (!canvas || !data) return;
  const ctx = canvas.getContext('2d');
  const pr = window.devicePixelRatio || 1;
  const W = canvas.width / pr, H = canvas.height / pr;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(pr, pr);
  ctx.fillStyle = '#0f1117'; ctx.fillRect(0, 0, W, H);
  const rsi = data.rsi; if (!rsi || rsi.length < 2) return;
  const n = rsi.length, mL = 14, mR = 54, mT = 12, mB = 14;
  const cW = W - mL - mR, cH = H - mT - mB;
  const mn = Math.max(0, Math.min(...rsi) - 8), mx = Math.min(100, Math.max(...rsi) + 8);
  const rng = mx - mn || 20, sY = cH / rng, sX = cW / (n - 1);
  const toY = (v) => mT + cH - (v - mn) * sY;
  ctx.font = '10px Inter,sans-serif';
  for (let v = Math.ceil(mn / 10) * 10; v <= mx; v += 10) {
    const gy = toY(v);
    ctx.beginPath(); ctx.strokeStyle = v === 50 ? '#2a3350' : '#1e2535'; ctx.lineWidth = v === 50 ? 1 : 0.5;
    ctx.moveTo(mL, gy); ctx.lineTo(mL + cW, gy); ctx.stroke();
    ctx.fillStyle = '#4a5568'; ctx.textAlign = 'left'; ctx.fillText(v, mL + cW + 4, gy + 4);
  }
  const y70 = toY(70), y30 = toY(30);
  if (y70 >= mT) { ctx.fillStyle = 'rgba(245,101,101,0.07)'; ctx.fillRect(mL, mT, cW, y70 - mT); }
  if (y30 <= mT + cH) { ctx.fillStyle = 'rgba(72,187,120,0.07)'; ctx.fillRect(mL, y30, cW, mT + cH - y30); }
  ctx.setLineDash([4, 4]);
  [[70, colors.rsiOB], [50, '#2a3350'], [30, colors.rsiOS]].forEach(([v, c]) => {
    const gy = toY(v); if (gy < mT || gy > mT + cH) return;
    ctx.strokeStyle = c; ctx.globalAlpha = v === 50 ? 0.5 : 0.6; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(mL, gy); ctx.lineTo(mL + cW, gy); ctx.stroke();
  });
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.strokeStyle = colors.rsi; ctx.lineWidth = colors.lw; ctx.lineJoin = 'round';
  for (let i = 0; i < n; i++) { const px = mL + i * sX, py = toY(rsi[i]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
  ctx.stroke();
  const lr = rsi[n - 1], dy = toY(lr);
  ctx.beginPath(); ctx.arc(mL + (n - 1) * sX, dy, 3, 0, Math.PI * 2); ctx.fillStyle = colors.rsi; ctx.fill();
  ctx.font = 'bold 11px Inter,sans-serif'; ctx.textAlign = 'right'; ctx.fillStyle = colors.rsi;
  ctx.fillText(lr.toFixed(1), W - 2, dy + 4);

  if (data.flags && data.flags.rdivLine) {
    const dl = data.flags.rdivLine;
    const rdisp = (data.rsiFullLen || n) - n;
    const curDisp = dl.oscCur.idx - rdisp, prevDisp = dl.oscPrev.idx - rdisp;
    if (curDisp >= 0 && prevDisp >= 0 && curDisp < n && prevDisp < n) {
      const px1 = mL + prevDisp * sX, py1 = toY(dl.oscPrev.val);
      const px2 = mL + curDisp * sX, py2 = toY(dl.oscCur.val);
      const divCol = dl.type === 'bull' ? '#48bb78' : '#f56565';
      ctx.save();
      ctx.strokeStyle = divCol; ctx.lineWidth = 2; ctx.globalAlpha = 0.95; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(px1, py1); ctx.lineTo(px2, py2); ctx.stroke();
      [[px1, py1], [px2, py2]].forEach(([px, py]) => {
        ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fillStyle = divCol; ctx.globalAlpha = 0.95; ctx.fill();
      });
      ctx.fillStyle = divCol; ctx.font = 'bold 10px Inter,sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(dl.type === 'bull' ? 'Bull Div' : 'Bear Div', (px1 + px2) / 2, Math.min(py1, py2) - 6);
      ctx.restore();
    }
  }
  (drawObjs || []).filter((o) => o.canvas === 'rsi').forEach((o) => drawObj(ctx, o));
}

export function drawModalMACD(canvas, data, colors, drawObjs) {
  if (!canvas || !data) return;
  const ctx = canvas.getContext('2d');
  const pr = window.devicePixelRatio || 1;
  const W = canvas.width / pr, H = canvas.height / pr;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(pr, pr);
  ctx.fillStyle = '#0f1117'; ctx.fillRect(0, 0, W, H);
  const { macd, signal, hist } = data; if (!hist || hist.length < 2) return;
  const n = hist.length, mL = 14, mR = 54, mT = 10, mB = 10;
  const cW = W - mL - mR, cH = H - mT - mB, sX = cW / (n - 1);
  const all = [...macd, ...signal, ...hist];
  const aM = Math.max(...all.map(Math.abs)) || 0.0001;
  const dp = aM > 10 ? 2 : aM > 1 ? 4 : 6;
  const sY = (cH * 0.45) / aM, zY = mT + cH / 2;
  const toY = (v) => zY - v * sY;
  ctx.font = '10px Inter,sans-serif'; ctx.fillStyle = '#4a5568'; ctx.textAlign = 'left';
  [-aM * 0.6, 0, aM * 0.6].forEach((v) => {
    const gy = toY(v); if (gy < mT || gy > mT + cH) return;
    ctx.beginPath(); ctx.strokeStyle = v === 0 ? '#2a3350' : '#1e2535'; ctx.lineWidth = v === 0 ? 1 : 0.5;
    ctx.moveTo(mL, gy); ctx.lineTo(mL + cW, gy); ctx.stroke();
    ctx.fillText(v.toFixed(dp), mL + cW + 4, gy + 4);
  });
  const hH = cH * 0.44;
  for (let i = 0; i < n; i++) {
    const px = mL + i * sX, bW = Math.max(1.5, sX * 0.65);
    const bH = Math.abs(hist[i]) / aM * hH, by = hist[i] >= 0 ? zY - bH : zY;
    const grow = i > 0 ? Math.abs(hist[i]) >= Math.abs(hist[i - 1]) : true;
    ctx.fillStyle = hist[i] >= 0 ? colors.bull : colors.bear; ctx.globalAlpha = grow ? 0.9 : 0.45;
    ctx.fillRect(px - bW / 2, by, bW, Math.max(1, bH));
  }
  ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.strokeStyle = colors.macd; ctx.lineWidth = colors.lw; ctx.lineJoin = 'round';
  for (let i = 0; i < n; i++) { const px = mL + i * sX, py = toY(macd[i]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
  ctx.stroke();
  ctx.beginPath(); ctx.strokeStyle = colors.signal; ctx.lineWidth = Math.max(1, colors.lw * 0.75); ctx.setLineDash([5, 3]);
  for (let i = 0; i < n; i++) { const px = mL + i * sX, py = toY(signal[i]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
  ctx.stroke(); ctx.setLineDash([]);
  const lM = macd[n - 1], lS = signal[n - 1], lH = hist[n - 1];
  ctx.font = 'bold 10px Inter,monospace'; ctx.textAlign = 'right';
  ctx.fillStyle = colors.macd; ctx.fillText(`M ${lM.toFixed(dp)}`, W - 2, toY(lM) + 4);
  ctx.fillStyle = colors.signal; ctx.fillText(`S ${lS.toFixed(dp)}`, W - 2, toY(lS) - 6);
  ctx.fillStyle = lH >= 0 ? colors.bull : colors.bear;
  ctx.fillText(`H ${lH.toFixed(dp)}`, W - 2, zY + (lH >= 0 ? -cH * 0.15 : cH * 0.15));

  if (data.flags && data.flags.mdivLine) {
    const dl = data.flags.mdivLine;
    const mdisp = (data.macdFullLen || n) - n;
    const curDisp = dl.oscCur.idx - mdisp, prevDisp = dl.oscPrev.idx - mdisp;
    if (curDisp >= 0 && prevDisp >= 0 && curDisp < n && prevDisp < n) {
      const px1 = mL + prevDisp * sX, py1 = toY(dl.oscPrev.val);
      const px2 = mL + curDisp * sX, py2 = toY(dl.oscCur.val);
      const divCol = dl.type === 'bull' ? '#48bb78' : '#f56565';
      ctx.save();
      ctx.strokeStyle = divCol; ctx.lineWidth = 2; ctx.globalAlpha = 0.95; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(px1, py1); ctx.lineTo(px2, py2); ctx.stroke();
      [[px1, py1], [px2, py2]].forEach(([px, py]) => {
        ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fillStyle = divCol; ctx.globalAlpha = 0.95; ctx.fill();
      });
      ctx.fillStyle = divCol; ctx.font = 'bold 10px Inter,sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(dl.type === 'bull' ? 'Bull Div' : 'Bear Div', (px1 + px2) / 2, Math.min(py1, py2) - 6);
      ctx.restore();
    }
  }
  (drawObjs || []).filter((o) => o.canvas === 'macd').forEach((o) => drawObj(ctx, o));
}

export function drawObj(ctx, obj) {
  if (!ctx) return;
  ctx.save();
  if (obj.type === 'brush') {
    ctx.beginPath(); ctx.strokeStyle = obj.color; ctx.lineWidth = obj.size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    obj.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  } else if (obj.type === 'trendline' && obj.points.length === 2) {
    ctx.beginPath(); ctx.strokeStyle = obj.color; ctx.lineWidth = obj.size; ctx.setLineDash([5, 3]);
    ctx.moveTo(obj.points[0][0], obj.points[0][1]); ctx.lineTo(obj.points[1][0], obj.points[1][1]);
    ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.restore();
}

export function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy) || 0));
  return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
}
