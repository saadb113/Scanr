// RSI/MACD/divergence math for the Scanner grid + modal — ported verbatim
// (same formulas, same pivot-divergence algorithm) from public/js/app.js's
// calcRSI()/ema()/calcMACD()/detectSignals()/pivotLows()/pivotHighs().
// Kept byte-for-byte equivalent so the scanner's filters/signals/divergence
// lines match the legacy page exactly.

export function calcRSI(closes, len) {
  if (closes.length < len + 1) return [];
  let gS = 0, lS = 0;
  for (let i = 1; i <= len; i++) { const d = closes[i] - closes[i - 1]; d >= 0 ? gS += d : lS -= d; }
  let aG = gS / len, aL = lS / len;
  const out = [];
  for (let i = len; i < closes.length - 1; i++) {
    const d = closes[i + 1] - closes[i];
    aG = (aG * (len - 1) + Math.max(0, d)) / len;
    aL = (aL * (len - 1) + Math.max(0, -d)) / len;
    out.push(aL === 0 ? 100 : 100 - (100 / (1 + aG / aL)));
  }
  return out;
}

export function ema(data, p) {
  if (data.length < p) return [];
  const k = 2 / (p + 1);
  let e = data.slice(0, p).reduce((a, b) => a + b, 0) / p;
  const out = [e];
  for (let i = p; i < data.length; i++) { e = data[i] * k + e * (1 - k); out.push(e); }
  return out;
}

export function calcMACD(closes, fast, slow, sig) {
  const ef = ema(closes, fast), es = ema(closes, slow);
  const off = slow - fast;
  const ml = es.map((s, i) => ef[i + off] - s);
  const sl2 = ema(ml, sig);
  const mla = ml.slice(sig - 1);
  const hl = mla.map((m, i) => m - sl2[i]);
  const N = Math.min(mla.length, sl2.length, hl.length);
  return { ml: mla.slice(-N), sl2: sl2.slice(-N), hl: hl.slice(-N) };
}

const DIV_LBL = 5, DIV_LBR = 5, DIV_RANGE_LO = 5, DIV_RANGE_HI = 60;

export function pivotLows(arr, lbL, lbR) {
  const pivots = [];
  for (let i = lbL; i <= arr.length - lbR - 1; i++) {
    const v = arr[i];
    let ok = true;
    for (let j = i - lbL; j <= i + lbR; j++) { if (j !== i && arr[j] <= v) { ok = false; break; } }
    if (ok) pivots.push({ idx: i, val: v });
  }
  return pivots;
}

export function pivotHighs(arr, lbL, lbR) {
  const pivots = [];
  for (let i = lbL; i <= arr.length - lbR - 1; i++) {
    const v = arr[i];
    let ok = true;
    for (let j = i - lbL; j <= i + lbR; j++) { if (j !== i && arr[j] >= v) { ok = false; break; } }
    if (ok) pivots.push({ idx: i, val: v });
  }
  return pivots;
}

// Pine-indicator-equivalent signal detection: OB/OS, MACD hist cross, RSI
// golden/death cross (RSI vs EMA9), and RSI/MACD pivot divergence scanning
// all consecutive pivot pairs (most recent first, no age cutoff).
export function detectSignals(highs, lows, closes, rsiArr, macdLine, sigLine, histArr) {
  const flags = {
    ob: false, os: false,
    rdivBull: false, rdivBear: false,
    mdivBull: false, mdivBear: false,
    mxBull: false, mxBear: false,
    rsiGolden: false, rsiDeath: false,
    rdivLine: null, mdivLine: null,
    rdivAge: Infinity, mdivAge: Infinity,
  };

  const rN = rsiArr.length;
  const mN = macdLine.length;
  if (rN < DIV_LBL + DIV_LBR + 5) return flags;

  flags.ob = rsiArr[rN - 1] >= 70;
  flags.os = rsiArr[rN - 1] <= 30;

  if (histArr.length >= 2) {
    const h1 = histArr[histArr.length - 2], h2 = histArr[histArr.length - 1];
    if (h1 < 0 && h2 >= 0) flags.mxBull = true;
    if (h1 > 0 && h2 <= 0) flags.mxBear = true;
  }

  if (rN >= 10) {
    const rsiEma9 = ema(rsiArr, 9);
    const eOff = rN - rsiEma9.length;
    const ri = rN - 1, ei = ri - eOff;
    if (ei >= 1) {
      if (rsiArr[ri - 1] <= rsiEma9[ei - 1] && rsiArr[ri] > rsiEma9[ei]) flags.rsiGolden = true;
      if (rsiArr[ri - 1] >= rsiEma9[ei - 1] && rsiArr[ri] < rsiEma9[ei]) flags.rsiDeath = true;
    }
  }

  const rPlows = pivotLows(rsiArr, DIV_LBL, DIV_LBR);
  const rPhighs = pivotHighs(rsiArr, DIV_LBL, DIV_LBR);

  for (let ci = rPlows.length - 1; ci >= 1; ci--) {
    const cur = rPlows[ci], prev = rPlows[ci - 1];
    const barsBetween = cur.idx - prev.idx;
    if (barsBetween < DIV_RANGE_LO || barsBetween > DIV_RANGE_HI) continue;
    if (lows[cur.idx] < lows[prev.idx] && cur.val > prev.val) {
      const age = (rN - 1) - cur.idx;
      if (age < flags.rdivAge) {
        flags.rdivBull = true; flags.rdivAge = age;
        flags.rdivLine = { type: 'bull', oscPrev: prev, oscCur: cur };
      }
    }
  }
  for (let ci = rPhighs.length - 1; ci >= 1; ci--) {
    const cur = rPhighs[ci], prev = rPhighs[ci - 1];
    const barsBetween = cur.idx - prev.idx;
    if (barsBetween < DIV_RANGE_LO || barsBetween > DIV_RANGE_HI) continue;
    if (highs[cur.idx] > highs[prev.idx] && cur.val < prev.val) {
      const age = (rN - 1) - cur.idx;
      if (!flags.rdivBull && age < flags.rdivAge) {
        flags.rdivBear = true; flags.rdivAge = age;
        flags.rdivLine = { type: 'bear', oscPrev: prev, oscCur: cur };
      }
    }
  }

  const mPlows = pivotLows(macdLine, DIV_LBL, DIV_LBR);
  const mPhighs = pivotHighs(macdLine, DIV_LBL, DIV_LBR);
  const WIN = DIV_LBL + DIV_LBR + 5;

  for (let ci = mPlows.length - 1; ci >= 1; ci--) {
    const cur = mPlows[ci], prev = mPlows[ci - 1];
    if (cur.val >= 0) continue;
    const barsBetween = cur.idx - prev.idx;
    if (barsBetween < DIV_RANGE_LO || barsBetween > DIV_RANGE_HI) continue;
    const winStart = Math.max(0, cur.idx - WIN + 1);
    const winSlice = macdLine.slice(winStart, cur.idx + 1);
    if (Math.max(...winSlice) >= 0) continue;
    if (lows[cur.idx] < lows[prev.idx] && cur.val > prev.val) {
      const age = (mN - 1) - cur.idx;
      if (age < flags.mdivAge) {
        flags.mdivBull = true; flags.mdivAge = age;
        flags.mdivLine = { type: 'bull', oscPrev: prev, oscCur: cur };
      }
    }
  }
  for (let ci = mPhighs.length - 1; ci >= 1; ci--) {
    const cur = mPhighs[ci], prev = mPhighs[ci - 1];
    if (cur.val <= 0) continue;
    const barsBetween = cur.idx - prev.idx;
    if (barsBetween < DIV_RANGE_LO || barsBetween > DIV_RANGE_HI) continue;
    const winStart = Math.max(0, cur.idx - WIN + 1);
    const winSlice = macdLine.slice(winStart, cur.idx + 1);
    if (Math.min(...winSlice) <= 0) continue;
    if (highs[cur.idx] > highs[prev.idx] && cur.val < prev.val) {
      const age = (mN - 1) - cur.idx;
      if (!flags.mdivBull && age < flags.mdivAge) {
        flags.mdivBear = true; flags.mdivAge = age;
        flags.mdivLine = { type: 'bear', oscPrev: prev, oscCur: cur };
      }
    }
  }

  return flags;
}
