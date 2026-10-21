// List-mode coin row — ported from buildRowHtml()/makeRow() in public/js/app.js.
export default function CoinRow({ sym, data, starred, onOpen, onToggleWatchlist }) {
  const ohlc = data?.ohlc || [];
  const closes = ohlc.map((c) => c[3]);
  const price = closes.length ? closes[closes.length - 1] : 0;
  const prev = closes.length > 1 ? closes[closes.length - 2] : price;
  const pct = prev ? ((price - prev) / prev) * 100 : 0;
  const rsi = data?.rsi?.length ? data.rsi[data.rsi.length - 1] : null;
  const macd = data?.macd?.length ? data.macd[data.macd.length - 1] : null;
  const sig = data?.signal?.length ? data.signal[data.signal.length - 1] : null;
  const macdDir = (macd != null && sig != null) ? (macd > sig ? '▲' : '▼') : '—';
  const macdCol = macdDir === '▲' ? '#22c55e' : '#ef4444';
  const pctCol = pct >= 0 ? '#22c55e' : '#ef4444';
  const priceStr = price ? (price >= 1000 ? price.toFixed(1) : price >= 1 ? price.toFixed(3) : price.toFixed(5)) : '—';
  const f = data?.flags || {};

  const tags = [];
  if (f.ob) tags.push(['#f56565', '#fff', 'OB']);
  if (f.os) tags.push(['#48bb78', '#000', 'OS']);
  if (f.mxBull) tags.push(['#29ffb8', '#000', 'MX↑']);
  if (f.mxBear) tags.push(['#fc8181', '#fff', 'MX↓']);
  if (f.rdivBull) tags.push(['#f6ad55', '#000', 'R↑']);
  if (f.rdivBear) tags.push(['#e05c00', '#fff', 'R↓']);
  if (f.mdivBull) tags.push(['#63b3ed', '#000', 'M↑']);
  if (f.mdivBear) tags.push(['#3a7bd5', '#fff', 'M↓']);
  if (f.rsiGolden) tags.push(['#ffd700', '#000', 'G✦']);
  if (f.rsiDeath) tags.push(['#c0392b', '#fff', 'D✦']);

  return (
    <div className="list-row" data-symbol={sym} onClick={() => onOpen(sym)}>
      <div className="lr-sym">{sym.replace('USDT', '')}</div>
      <div className="lr-price">{priceStr}</div>
      <div className="lr-pct" style={{ color: pctCol }}>{price ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : '—'}</div>
      <div className="lr-stat"><span className="lr-label">RSI</span><span className="lr-rsi">{rsi != null ? rsi.toFixed(1) : '—'}</span></div>
      <div className="lr-stat"><span className="lr-label">MACD</span><span className="lr-macd" style={{ color: macdCol }}>{macdDir}</span></div>
      <div className="lr-tags">
        {tags.map(([bg, color, label]) => (
          <span key={label} className="lr-tag" style={{ background: bg, color }}>{label}</span>
        ))}
      </div>
      <button
        type="button"
        className={`wl-star${starred ? ' starred' : ''}`}
        title="Watchlist"
        onClick={(e) => { e.stopPropagation(); onToggleWatchlist(sym); }}
      >★</button>
    </div>
  );
}
