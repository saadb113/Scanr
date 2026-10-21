// Position-size math for the AI-result card in the coin modal — ported
// verbatim from calcPositionSize() in public/js/app.js. Leverage is passed
// in by the caller; the legacy page looked this up live from Bybit's
// instrument-info endpoint (bytFetchMaxLev) before rendering the AI result —
// this port defaults to 100x when no live lookup is available (see
// CoinModal.jsx), which only affects the *displayed* suggested leverage, not
// the entry/SL/TP the AI returned.
export function calcPositionSize(entry, sl, tp, posSettings, leverageOverride) {
  const capital = parseFloat(posSettings.capital) || 1000;
  const riskPct = parseFloat(posSettings.riskPerTrade ?? posSettings.risk) || 1;
  const accountType = posSettings.accountType || 'futures_cross';
  const feeRate = posSettings.feeRate != null ? parseFloat(posSettings.feeRate) : 0.0;

  entry = parseFloat(entry); sl = parseFloat(sl); tp = parseFloat(tp);
  if (!entry || !sl || entry === sl) return null;

  const isSpot = accountType === 'spot';
  const lev = isSpot ? 1 : (leverageOverride || 10);
  const riskAmt = capital * (riskPct / 100);
  const slDist = Math.abs(entry - sl);
  const qty = riskAmt / slDist;
  const posValue = qty * entry;
  const margin = posValue / lev;
  const feesTotal = feeRate > 0 ? posValue * (feeRate / 100) * 2 : 0;
  const netRisk = riskAmt + feesTotal;
  const tpDist = (tp && tp !== entry) ? Math.abs(tp - entry) : null;
  const profitRaw = tpDist ? qty * tpDist - feesTotal : null;
  const rrActual = (profitRaw != null && riskAmt > 0) ? (profitRaw / riskAmt).toFixed(2) : null;
  const marginPct = (margin / capital) * 100;

  const fmtP = (v) => (v != null ? '$' + Math.abs(v).toFixed(2) : '—');

  return {
    capital, riskPct, leverage: lev, accountType, feeRate,
    posValue, margin, marginPct, netRisk, profitRaw, rrActual, isSpot, fmtP,
  };
}
