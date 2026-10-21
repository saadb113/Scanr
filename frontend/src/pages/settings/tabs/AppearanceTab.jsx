import { useEffect, useState } from 'react';
import { api } from '../../../api/client';

const DEFAULT_COLORS = { rsi: '#29ffb8', rsiOB: '#f56565', rsiOS: '#48bb78', macd: '#63b3ed', signal: '#f6ad55', bull: '#48bb78', bear: '#f56565', price: '#e5e9f2', lw: 2 };
const DEFAULT_VISIBILITY = { price: true, rsi: true, macd: true };

export default function AppearanceTab() {
  const [colors, setColors] = useState(DEFAULT_COLORS);
  const [visibility, setVisibility] = useState(DEFAULT_VISIBILITY);
  const [priceType, setPriceType] = useState('candle');
  const [cellSize, setCellSize] = useState(160);
  const [accent, setAccent] = useState('#00e5a0');
  const [savedMsg, setSavedMsg] = useState(false);
  const [accentMsg, setAccentMsg] = useState(false);

  useEffect(() => {
    api.get('/api/settings').then((s) => {
      if (s.colors) setColors((c) => ({ ...c, ...s.colors }));
      if (s.visibility) setVisibility((v) => ({ ...v, ...s.visibility }));
      if (s.priceType) setPriceType(s.priceType);
      if (s.cellSize) setCellSize(s.cellSize);
      if (s.accentColor) setAccent(s.accentColor);
    }).catch(() => {});
  }, []);

  function setColor(key, value) {
    setColors((c) => ({ ...c, [key]: value }));
  }

  async function save() {
    await api.post('/api/settings', { cellSize, colors, visibility, priceType });
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2500);
  }

  async function saveAccent() {
    await api.post('/api/settings', { accentColor: accent });
    window.applyAccentColor?.(accent);
    setAccentMsg(true);
    setTimeout(() => setAccentMsg(false), 2500);
  }

  function resetAccent() {
    setAccent('#00e5a0');
  }

  return (
    <div className="sp-grid">
      <div className="sp-card">
        <div className="sp-card-title">RSI Colors</div>
        <div className="color-grid">
          <div className="s-row"><label>RSI Line</label><input type="color" value={colors.rsi} onChange={(e) => setColor('rsi', e.target.value)} /></div>
          <div className="s-row"><label>Overbought (70)</label><input type="color" value={colors.rsiOB} onChange={(e) => setColor('rsiOB', e.target.value)} /></div>
          <div className="s-row"><label>Oversold (30)</label><input type="color" value={colors.rsiOS} onChange={(e) => setColor('rsiOS', e.target.value)} /></div>
        </div>
      </div>

      <div className="sp-card">
        <div className="sp-card-title">MACD Colors</div>
        <div className="color-grid">
          <div className="s-row"><label>MACD Line</label><input type="color" value={colors.macd} onChange={(e) => setColor('macd', e.target.value)} /></div>
          <div className="s-row"><label>Signal Line</label><input type="color" value={colors.signal} onChange={(e) => setColor('signal', e.target.value)} /></div>
          <div className="s-row"><label>Bull Histogram</label><input type="color" value={colors.bull} onChange={(e) => setColor('bull', e.target.value)} /></div>
          <div className="s-row"><label>Bear Histogram</label><input type="color" value={colors.bear} onChange={(e) => setColor('bear', e.target.value)} /></div>
        </div>
      </div>

      <div className="sp-card">
        <div className="sp-card-title">Price Chart</div>
        <div className="s-row"><label>Price Line Color</label><input type="color" value={colors.price} onChange={(e) => setColor('price', e.target.value)} /></div>
        <div className="s-row">
          <label>Chart Type</label>
          <select className="s-input-full" value={priceType} onChange={(e) => setPriceType(e.target.value)}>
            <option value="line">Line Chart</option>
            <option value="candle">Candlestick</option>
          </select>
        </div>
        <div className="s-row">
          <label>Line Width &nbsp;<span className="rval">{colors.lw}</span></label>
          <input type="range" min="1" max="8" value={colors.lw} onChange={(e) => setColor('lw', +e.target.value)} />
        </div>
        <div className="s-row">
          <label>Card Size &nbsp;<span className="rval">{cellSize}</span></label>
          <input type="range" min="80" max="280" value={cellSize} onChange={(e) => setCellSize(+e.target.value)} />
        </div>
      </div>

      <div className="sp-card">
        <div className="sp-card-title">Chart Visibility</div>
        <div className="filter-toggle-row"><span className="filter-toggle-label"><span className="fdot" style={{ background: '#e5e9f2' }} />Show Price Chart</span><label className="toggle-switch"><input type="checkbox" checked={visibility.price} onChange={(e) => setVisibility((v) => ({ ...v, price: e.target.checked }))} /><span className="slider" /></label></div>
        <div className="filter-toggle-row"><span className="filter-toggle-label"><span className="fdot" style={{ background: '#29ffb8' }} />Show RSI</span><label className="toggle-switch"><input type="checkbox" checked={visibility.rsi} onChange={(e) => setVisibility((v) => ({ ...v, rsi: e.target.checked }))} /><span className="slider" /></label></div>
        <div className="filter-toggle-row"><span className="filter-toggle-label"><span className="fdot" style={{ background: '#63b3ed' }} />Show MACD</span><label className="toggle-switch"><input type="checkbox" checked={visibility.macd} onChange={(e) => setVisibility((v) => ({ ...v, macd: e.target.checked }))} /><span className="slider" /></label></div>
      </div>

      <div className="sp-card">
        <div className="sp-card-title">Accent Color</div>
        <div className="s-row" style={{ alignItems: 'center' }}>
          <label>Accent Color</label>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} style={{ width: '2.4rem', height: '2rem', border: 'none', background: 'none', cursor: 'pointer', padding: 0 }} />
            <input
              type="text" maxLength={7} value={accent}
              onChange={(e) => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) setAccent(e.target.value); }}
              style={{ width: '6rem', background: 'var(--bg-input,#090c12)', border: '1px solid var(--border,#1a2030)', borderRadius: 6, padding: '0.35rem 0.5rem', color: 'var(--text-primary,#e5e9f2)', fontFamily: 'monospace', fontSize: 13, outline: 'none' }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.7rem' }}>
          <button onClick={saveAccent} style={{ flex: 1, background: 'linear-gradient(135deg,#065f46,#00c896)', color: '#000', border: 'none', borderRadius: 8, padding: '0.45rem', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>💾 Save</button>
          <button onClick={resetAccent} style={{ background: 'none', border: '1px solid var(--border,#1a2030)', color: 'var(--text-muted,#6b7897)', borderRadius: 8, padding: '0.45rem 0.75rem', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Reset</button>
        </div>
        {accentMsg && <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--accent-green,#00e5a0)', marginTop: '0.4rem', fontWeight: 600 }}>✓ Saved!</div>}
      </div>

      <div className="sp-card">
        <div className="sp-card-title">Save Appearance</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: '0.6rem' }}>Colors, chart type, line width and card size above.</p>
        <button onClick={save} style={{ background: 'linear-gradient(135deg,#065f46,#00c896)', color: '#000', border: 'none', borderRadius: 8, padding: '0.5rem 1.2rem', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>💾 Save</button>
        {savedMsg && <div style={{ fontSize: 13, color: 'var(--accent-green,#00e5a0)', marginTop: '0.4rem', fontWeight: 600 }}>✓ Saved!</div>}
      </div>
    </div>
  );
}
