// Grid-cell mini-chart canvas drawing — ported verbatim from public/js/app.js
// (drawCell/miniPrice/miniRSI/miniMACD/drawSignalTags/drawPlaceholder).
// Pure functions operating on a 2D canvas context so React only has to
// supply a <canvas> ref and call draw() on data/settings changes, same as
// the legacy page's imperative drawCell() calls.

export function drawPlaceholder(canvas, sym, cellSize) {
  if (!canvas) return;
  const pr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth || Math.round(cellSize * 1.6);
  const H = canvas.offsetHeight || cellSize;
  if (!W || !H) return;
  canvas.width = W * pr; canvas.height = H * pr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(pr, pr);
  ctx.fillStyle = '#13171f'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#1e2535'; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(0, H * 0.52); ctx.lineTo(W, H * 0.52); ctx.stroke();
  ctx.font = `bold ${Math.max(8, W * 0.065)}px Inter,sans-serif`;
  ctx.fillStyle = '#252d3d'; ctx.textAlign = 'right';
  ctx.fillText(sym.replace('USDT', ''), W - 3, 11);
}

function miniPrice(ctx, data, x, y, W, H, sym, colors, priceType) {
  const ohlc = data.ohlc;
  if (!ohlc || ohlc.length < 2) return;
  const n = ohlc.length;
  const rW = W * 0.95, sX = rW / (n - 1);
  const isCandle = priceType === 'candle';

  const highs = ohlc.map((c) => c[1]), lows = ohlc.map((c) => c[2]), closes = ohlc.map((c) => c[3]);
  const pMin = Math.min(...lows), pMax = Math.max(...highs);
  const pRng = pMax - pMin || pMin * 0.001;
  const pad = pRng * 0.05;
  const lo = pMin - pad, hi = pMax + pad, rng = hi - lo;
  const toY = (v) => y + H - ((v - lo) / rng) * H;

  const midY = toY((hi + lo) / 2);
  ctx.strokeStyle = '#1e2535'; ctx.lineWidth = 0.5; ctx.setLineDash([2, 3]);
  ctx.beginPath(); ctx.moveTo(x, midY); ctx.lineTo(x + W, midY); ctx.stroke(); ctx.setLineDash([]);

  if (isCandle) {
    const candleW = Math.max(1.5, sX * 0.7);
    for (let i = 0; i < n; i++) {
      const [o, h, l, c] = ohlc[i];
      const bull = c >= o;
      const px = x + i * sX;
      const cy1 = toY(Math.max(o, c)), cy2 = toY(Math.min(o, c));
      const bodyH = Math.max(1, cy2 - cy1);
      ctx.strokeStyle = bull ? colors.bull : colors.bear;
      ctx.lineWidth = Math.max(0.8, candleW * 0.12);
      ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(px, toY(h)); ctx.lineTo(px, toY(l)); ctx.stroke();
      ctx.fillStyle = bull ? colors.bull : colors.bear;
      ctx.globalAlpha = bull ? 0.85 : 0.7;
      ctx.fillRect(px - candleW / 2, cy1, candleW, bodyH);
    }
    ctx.globalAlpha = 1;
  } else {
    ctx.beginPath(); ctx.strokeStyle = colors.price;
    ctx.lineWidth = Math.max(1, colors.lw * 0.7); ctx.lineJoin = 'round';
    for (let i = 0; i < n; i++) { const px = x + i * sX, py = toY(closes[i]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.stroke();
  }

  ctx.font = `bold ${Math.max(8, W * 0.07)}px Inter,sans-serif`;
  ctx.textAlign = 'left'; ctx.fillStyle = '#6b7897';
  ctx.fillText(sym.replace('USDT', ''), x + 2, y + 11);

  const lastClose = closes[closes.length - 1];
  const priceStr = lastClose >= 1000 ? lastClose.toFixed(1) : lastClose >= 1 ? lastClose.toFixed(2) : lastClose.toFixed(4);
  ctx.textAlign = 'right'; ctx.fillStyle = '#29ffb8';
  ctx.fillText(priceStr, x + W - 2, y + 11);

  const lastPx = x + (n - 1) * sX, lastPy = toY(lastClose);
  ctx.beginPath(); ctx.arc(lastPx, lastPy, 2.5, 0, Math.PI * 2); ctx.fillStyle = '#29ffb8'; ctx.fill();
}

function miniRSI(ctx, data, x, y, W, H, sym, colors) {
  const rsi = data.rsi;
  if (!rsi || rsi.length < 2) return;
  const n = rsi.length, rW = W * 0.9, sX = rW / (n - 1);
  const mn = Math.max(0, Math.min(...rsi) - 5), mx = Math.min(100, Math.max(...rsi) + 5);
  const rng = mx - mn || 20, sY = H / rng;
  const toY = (v) => y + H - (v - mn) * sY;
  const y70 = toY(70), y30 = toY(30);
  if (y70 > y && y70 < y + H) { ctx.fillStyle = 'rgba(245,101,101,0.05)'; ctx.fillRect(x, y, W, y70 - y); }
  if (y30 < y + H && y30 > y) { ctx.fillStyle = 'rgba(72,187,120,0.05)'; ctx.fillRect(x, y30, W, y + H - y30); }
  ctx.setLineDash([2, 3]); ctx.lineWidth = 0.6;
  [[70, colors.rsiOB], [30, colors.rsiOS]].forEach(([v, c]) => {
    const gy = toY(v); if (gy < y || gy > y + H) return;
    ctx.strokeStyle = c; ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + W, gy); ctx.stroke();
  });
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.strokeStyle = colors.rsi;
  ctx.lineWidth = Math.max(1.1, colors.lw * 0.6); ctx.lineJoin = 'round';
  for (let i = 0; i < n; i++) { const px = x + i * sX, py = toY(rsi[i]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
  ctx.stroke();

  if (data.flags && data.flags.rdivLine) {
    const dl = data.flags.rdivLine;
    const dispStart = (data.rsiFullLen || n) - n;
    const curDisp = dl.oscCur.idx - dispStart, prevDisp = dl.oscPrev.idx - dispStart;
    if (curDisp >= 0 && prevDisp >= 0 && curDisp < n && prevDisp < n) {
      const px1 = x + prevDisp * sX, py1 = toY(dl.oscPrev.val);
      const px2 = x + curDisp * sX, py2 = toY(dl.oscCur.val);
      const divCol = dl.type === 'bull' ? '#48bb78' : '#f56565';
      ctx.save();
      ctx.strokeStyle = divCol; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.9; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(px1, py1); ctx.lineTo(px2, py2); ctx.stroke();
      [[px1, py1], [px2, py2]].forEach(([px, py]) => {
        ctx.beginPath(); ctx.arc(px, py, 2.5, 0, Math.PI * 2); ctx.fillStyle = divCol; ctx.fill();
      });
      ctx.restore();
    }
  }
  const lr = rsi[n - 1], rc = lr >= 70 ? colors.rsiOB : lr <= 30 ? colors.rsiOS : colors.rsi;
  ctx.font = `bold ${Math.max(7, W * 0.062)}px Inter,sans-serif`;
  ctx.textAlign = 'right'; ctx.fillStyle = rc;
  ctx.fillText(sym.replace('USDT', ''), W - 2, y + 10);
}

function miniMACD(ctx, data, x, y, W, H, colors) {
  const { macd, signal, hist } = data;
  if (!hist || hist.length < 2) return;
  const n = hist.length, rW = W * 0.9, sX = rW / (n - 1);
  const all = [...macd, ...signal, ...hist];
  const aM = Math.max(...all.map(Math.abs)) || 0.0001;
  const hH = H * 0.44, sY = (H * 0.9) / (aM * 2), zY = y + H * 0.5;
  ctx.strokeStyle = '#1e2535'; ctx.lineWidth = 0.5; ctx.setLineDash([2, 3]);
  ctx.beginPath(); ctx.moveTo(x, zY); ctx.lineTo(x + W, zY); ctx.stroke();
  ctx.setLineDash([]);
  for (let i = 0; i < n; i++) {
    const px = x + i * sX, bW = Math.max(1, sX * 0.65);
    const bH = Math.abs(hist[i]) / aM * hH;
    const by = hist[i] >= 0 ? zY - bH : zY;
    const grow = i > 0 ? Math.abs(hist[i]) >= Math.abs(hist[i - 1]) : true;
    ctx.fillStyle = hist[i] >= 0 ? colors.bull : colors.bear;
    ctx.globalAlpha = grow ? 0.85 : 0.4;
    ctx.fillRect(px - bW / 2, by, bW, Math.max(1, bH));
  }
  ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.strokeStyle = colors.macd;
  ctx.lineWidth = Math.max(1, colors.lw * 0.65); ctx.lineJoin = 'round';
  for (let i = 0; i < n; i++) { const px = x + i * sX, py = zY - macd[i] * sY; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
  ctx.stroke();
  ctx.beginPath(); ctx.strokeStyle = colors.signal;
  ctx.lineWidth = Math.max(0.8, colors.lw * 0.5); ctx.setLineDash([3, 2]);
  for (let i = 0; i < n; i++) { const px = x + i * sX, py = zY - signal[i] * sY; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
  ctx.stroke(); ctx.setLineDash([]);

  if (data.flags && data.flags.mdivLine) {
    const dl = data.flags.mdivLine;
    const dispStart = (data.macdFullLen || n) - n;
    const curDisp = dl.oscCur.idx - dispStart, prevDisp = dl.oscPrev.idx - dispStart;
    if (curDisp >= 0 && prevDisp >= 0 && curDisp < n && prevDisp < n) {
      const px1 = x + prevDisp * sX, py1 = zY - dl.oscPrev.val * sY;
      const px2 = x + curDisp * sX, py2 = zY - dl.oscCur.val * sY;
      const divCol = dl.type === 'bull' ? '#48bb78' : '#f56565';
      ctx.save();
      ctx.strokeStyle = divCol; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.9; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(px1, py1); ctx.lineTo(px2, py2); ctx.stroke();
      [[px1, py1], [px2, py2]].forEach(([px, py]) => {
        ctx.beginPath(); ctx.arc(px, py, 2.5, 0, Math.PI * 2); ctx.fillStyle = divCol; ctx.fill();
      });
      ctx.restore();
    }
  }
}

function drawSignalTags(ctx, f, W, H) {
  const tags = [];
  if (f.ob) tags.push({ c: '#f56565' });
  if (f.os) tags.push({ c: '#48bb78' });
  if (f.mxBull) tags.push({ c: '#29ffb8' });
  if (f.mxBear) tags.push({ c: '#fc8181' });
  if (f.rdivBull) tags.push({ c: '#f6ad55' });
  if (f.rdivBear) tags.push({ c: '#e05c00' });
  if (f.mdivBull) tags.push({ c: '#63b3ed' });
  if (f.mdivBear) tags.push({ c: '#3a7bd5' });
  if (f.rsiGolden) tags.push({ c: '#ffd700' });
  if (f.rsiDeath) tags.push({ c: '#c0392b' });
  const dotR = 3.5, spacing = 10;
  let xOff = W - 6;
  tags.forEach(({ c }) => {
    ctx.beginPath(); ctx.arc(xOff, H - 6, dotR, 0, Math.PI * 2);
    ctx.fillStyle = c; ctx.globalAlpha = 0.92; ctx.fill();
    xOff -= spacing;
  });
  ctx.globalAlpha = 1;
}

export function drawCell(canvas, data, sym, { cellSize, colors, visibility, priceType, tfLabel }) {
  if (!canvas || !data) return;
  const pr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth || Math.round(cellSize * 1.6);
  const H = canvas.offsetHeight || cellSize;
  if (!W || !H) return;
  canvas.width = W * pr; canvas.height = H * pr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(pr, pr);
  ctx.fillStyle = '#13171f'; ctx.fillRect(0, 0, W, H);

  const showPrice = visibility.price, showRSI = visibility.rsi, showMACD = visibility.macd;
  const visibleCount = (showPrice ? 1 : 0) + (showRSI ? 1 : 0) + (showMACD ? 1 : 0);
  if (visibleCount === 0) return;

  const gap = 2;
  let yPos = 0;
  if (visibleCount === 1) {
    const chartH = H - gap * 2;
    if (showPrice) miniPrice(ctx, data, 0, yPos, W, chartH, sym, colors, priceType);
    else if (showRSI) miniRSI(ctx, data, 0, yPos, W, chartH, sym, colors);
    else if (showMACD) miniMACD(ctx, data, 0, yPos, W, chartH, colors);
  } else if (visibleCount === 2) {
    const chartH = Math.floor(H / 2) - gap;
    if (showPrice) { miniPrice(ctx, data, 0, yPos, W, chartH, sym, colors, priceType); yPos += chartH + gap; }
    if (showRSI) { miniRSI(ctx, data, 0, yPos, W, chartH, sym, colors); yPos += chartH + gap; }
    if (showMACD) miniMACD(ctx, data, 0, yPos, W, H - yPos, colors);
  } else {
    const pH = Math.floor(H * 0.40) - gap;
    const rH = Math.floor(H * 0.30) - gap;
    const mH = H - pH - rH - gap * 4;
    miniPrice(ctx, data, 0, 0, W, pH, sym, colors, priceType);
    miniRSI(ctx, data, 0, pH + gap, W, rH, sym, colors);
    miniMACD(ctx, data, 0, pH + rH + gap * 2, W, mH, colors);
  }

  if (data.flags) drawSignalTags(ctx, data.flags, W, H);

  if (tfLabel) {
    ctx.font = `bold ${Math.max(7, W * 0.055)}px Inter,sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f0b90b';
    ctx.fillText(tfLabel, 4, H - 6);
  }
}
