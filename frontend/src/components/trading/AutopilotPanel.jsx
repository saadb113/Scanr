import { useCallback, useEffect, useMemo, useState } from 'react';
import { bybitRequest } from '../../utils/bybit';

// Terminal-only "SL Mode" autopilot tab. Ported from the #byt-autopilot
// markup + apXxx() functions in terminal.html / app.js. `autopilot` is the
// useAutopilot() hook instance (shared with the rest of Terminal.jsx so the
// Positions tab's "Autopilot" button and this panel reflect the same state).
//
// Class names use a "trd-ap-" prefix rather than the original bare "ap-":
// scanrApp.css (loaded globally for the not-yet-ported Scanner page) already
// defines its own unrelated .ap-* rules for Scanner's inline autopilot
// overlay, and since Vite doesn't unload CSS between SPA routes, reusing
// "ap-" here would silently inherit/clash with that stylesheet.
export default function AutopilotPanel({ autopilot, creds, clockOffset }) {
  const { running, position, triggered, livePrice, logs, start, stop } = autopilot;
  const [positions, setPositions] = useState([]);
  const [loadingPositions, setLoadingPositions] = useState(true);
  const [selectedSym, setSelectedSym] = useState('');

  const loadPositions = useCallback(async () => {
    if (!creds?.apiKey) { setPositions([]); setLoadingPositions(false); return; }
    setLoadingPositions(true);
    try {
      const res = await bybitRequest(creds, 'GET', '/v5/position/list', { category: 'linear', settleCoin: 'USDT' }, null, clockOffset);
      setPositions((res.result?.list || []).filter((p) => parseFloat(p.size) > 0));
    } catch {
      setPositions([]);
    } finally {
      setLoadingPositions(false);
    }
  }, [creds, clockOffset]);

  useEffect(() => { if (!running) loadPositions(); }, [running, loadPositions]);

  const selected = positions.find((p) => p.symbol === selectedSym);
  const preview = useMemo(() => {
    if (!selected) return null;
    const entry = parseFloat(selected.avgPrice);
    const sl = parseFloat(selected.stopLoss) || 0;
    const tp = parseFloat(selected.takeProfit) || 0;
    const isLong = selected.side === 'Buy';
    const slDist = sl ? Math.abs(entry - sl) : 0;
    const tpDist = tp ? Math.abs(tp - entry) : 0;
    const rr = slDist && tpDist ? (tpDist / slDist).toFixed(2) : '—';
    const halfSlPrice = sl ? (isLong ? entry - slDist * 0.5 : entry + slDist * 0.5).toFixed(4) : '—';
    return { entry, sl, tp, rr, halfSlPrice, size: selected.size, lev: selected.leverage, canStart: !!(sl && tp) };
  }, [selected]);

  async function handleStart() {
    if (!selected || !preview?.canStart) return;
    await start({
      sym: selected.symbol, entry: preview.entry, sl: preview.sl, tp: preview.tp,
      side: selected.side, size: parseFloat(selected.size), lev: selected.leverage,
    });
  }

  if (running && position) {
    const p = position;
    const maxProfit = Math.abs(p.tp - p.entry) * p.size;
    const maxLoss = Math.abs((p.initSl ?? p.sl) - p.entry) * p.size;
    const wsPnl = livePrice > 0 ? (p.isLong ? (livePrice - p.entry) * p.size : (p.entry - livePrice) * p.size) : 0;
    const tpPct = wsPnl > 0 && maxProfit ? Math.min(99, (wsPnl / maxProfit) * 100) : 0;
    const slPct = wsPnl < 0 && maxLoss ? Math.min(99, (Math.abs(wsPnl) / maxLoss) * 100) : 0;

    return (
      <div style={{ maxWidth: 700 }}>
        <div className="trd-ap-status-bar">
          <div className="trd-ap-pulse monitoring" />
          <span style={{ fontWeight: 700 }}>Monitoring {p.sym || p.symbol}…</span>
          <span style={{ color: 'var(--text-muted)' }}>{livePrice ? livePrice.toPrecision(7) : '—'}</span>
        </div>
        <div className="trd-ap-trade-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontWeight: 800 }}>{p.sym || p.symbol}</span>
              <span className={`trd-pos-side ${p.isLong ? 'long' : 'short'}`}>{p.isLong ? '▲ LONG' : '▼ SHORT'}</span>
              {p.lev && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.lev}x</span>}
            </div>
            <div style={{ fontWeight: 700, color: wsPnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
              {wsPnl >= 0 ? '+' : '-'}${Math.abs(wsPnl).toFixed(2)}
            </div>
          </div>
          <div className="trd-ap-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: '0.55rem' }}>
            <div className="trd-ap-stat"><div className="trd-ap-stat-label">Entry</div><div className="trd-ap-stat-val">{p.entry?.toPrecision(5)}</div></div>
            <div className="trd-ap-stat" style={{ borderColor: 'rgba(255,77,106,0.3)' }}><div className="trd-ap-stat-label">Stop Loss</div><div className="trd-ap-stat-val" style={{ color: 'var(--accent-red)' }}>{p.sl}</div></div>
            <div className="trd-ap-stat" style={{ borderColor: 'rgba(0,229,160,0.3)' }}><div className="trd-ap-stat-label">Take Profit</div><div className="trd-ap-stat-val" style={{ color: 'var(--accent-green)' }}>{p.tp}</div></div>
          </div>
          <div style={{ marginBottom: '0.4rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}><span>TP Progress</span><span>{tpPct.toFixed(1)}%</span></div>
            <div className="trd-ap-progress-track">
              <div className="trd-ap-progress-fill toward-tp" style={{ width: `${tpPct}%` }} />
              <div className="trd-ap-milestone" style={{ left: '50%' }}><div className="trd-ap-milestone-label">50%</div></div>
              <div className="trd-ap-milestone" style={{ left: '60%' }}><div className="trd-ap-milestone-label">60%</div></div>
            </div>
          </div>
          <div style={{ marginBottom: '0.65rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}><span>SL Drawdown</span><span>{slPct.toFixed(1)}%</span></div>
            <div className="trd-ap-progress-track">
              <div className="trd-ap-progress-fill toward-sl" style={{ width: `${slPct}%` }} />
              <div className="trd-ap-milestone" style={{ left: '60%' }}><div className="trd-ap-milestone-label">60%</div></div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.65rem' }}>
            <div className="trd-ap-stat" style={{ flex: 1, minWidth: 120 }}><div className="trd-ap-stat-label">TP 50% → Half SL</div><div className="trd-ap-stat-val" style={{ color: triggered.tp50 ? '#fbbf24' : 'var(--text-muted)', fontSize: 11 }}>{triggered.tp50 ? `✓ SL → ${p.sl}` : 'Waiting…'}</div></div>
            <div className="trd-ap-stat" style={{ flex: 1, minWidth: 120 }}><div className="trd-ap-stat-label">TP 60% → Breakeven</div><div className="trd-ap-stat-val" style={{ color: triggered.tp50 ? '#fbbf24' : 'var(--text-muted)', fontSize: 11 }}>{triggered.tp50 ? `✓ SL → BE ${p.entry?.toFixed(4)}` : 'Waiting…'}</div></div>
            <div className="trd-ap-stat" style={{ flex: 1, minWidth: 120 }}><div className="trd-ap-stat-label">SL 60% → BE Close</div><div className="trd-ap-stat-val" style={{ color: triggered.sl60 ? '#fbbf24' : 'var(--text-muted)', fontSize: 11 }}>{triggered.sl60 ? `✓ TP → BE ${p.entry?.toFixed(4)}` : 'Waiting…'}</div></div>
          </div>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: '0.3rem' }}>Action Log</div>
        <div className="trd-ap-log">
          {logs.map((l, i) => (
            <div key={i} className="trd-ap-log-row"><span className="trd-ap-log-time">{l.time}</span><span className="trd-ap-log-msg">{l.msg}</span></div>
          ))}
        </div>
        <div style={{ marginTop: '0.75rem' }}>
          <button type="button" className="trd-ap-stop-btn" onClick={stop}>⬛ Stop Autopilot</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 700 }}>
      <div className="trd-summary" style={{ padding: '1rem' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#a855f7', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: '0.75rem' }}>SL Mode — Trade Rules</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.85rem' }}>
          <div style={{ background: 'var(--bg-input)', borderRadius: 4, padding: '0.5rem 0.7rem', borderLeft: '3px solid var(--accent-green)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>
            <span style={{ color: 'var(--accent-green)', fontWeight: 700 }}>↑ TP Direction:</span> Price reaches <strong>50%</strong> toward TP → SL moves to <strong>half initial risk</strong> · Price reaches <strong>60%</strong> toward TP → SL moves to <strong style={{ color: 'var(--accent-amber)' }}>entry (breakeven)</strong>
          </div>
          <div style={{ background: 'var(--bg-input)', borderRadius: 4, padding: '0.5rem 0.7rem', borderLeft: '3px solid var(--accent-red)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>
            <span style={{ color: 'var(--accent-red)', fontWeight: 700 }}>↓ SL Direction:</span> Price drops <strong>60%</strong> toward SL → TP moves to <strong style={{ color: 'var(--accent-amber)' }}>entry (breakeven close)</strong>
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--border-dim)', paddingTop: '0.75rem' }}>
          <div className="trd-field" style={{ marginBottom: '0.6rem' }}>
            <label>Monitor Position (Symbol)</label>
            <select className="trd-input" value={selectedSym} onChange={(e) => setSelectedSym(e.target.value)}>
              <option value="">{loadingPositions ? 'Loading…' : positions.length ? '— Select open position —' : '— No open positions —'}</option>
              {positions.map((p) => (
                <option key={p.symbol} value={p.symbol}>
                  {p.symbol} {p.side === 'Buy' ? '▲ LONG' : '▼ SHORT'} · entry {parseFloat(p.avgPrice).toPrecision(5)} · PnL {parseFloat(p.unrealisedPnl) >= 0 ? '+' : ''}{parseFloat(p.unrealisedPnl).toFixed(2)}$
                </option>
              ))}
            </select>
          </div>
          {preview && (
            <div style={{ marginBottom: '0.65rem' }}>
              <div className="trd-ap-grid">
                <div className="trd-ap-stat"><div className="trd-ap-stat-label">Entry</div><div className="trd-ap-stat-val">{preview.entry.toPrecision(5)}</div></div>
                <div className="trd-ap-stat" style={{ borderColor: 'rgba(255,77,106,0.3)' }}><div className="trd-ap-stat-label">Current SL</div><div className="trd-ap-stat-val" style={{ color: 'var(--accent-red)' }}>{preview.sl || '—'}</div></div>
                <div className="trd-ap-stat" style={{ borderColor: 'rgba(0,229,160,0.3)' }}><div className="trd-ap-stat-label">Current TP</div><div className="trd-ap-stat-val" style={{ color: 'var(--accent-green)' }}>{preview.tp || '—'}</div></div>
                <div className="trd-ap-stat"><div className="trd-ap-stat-label">Size</div><div className="trd-ap-stat-val">{preview.size}</div></div>
                <div className="trd-ap-stat"><div className="trd-ap-stat-label">Leverage</div><div className="trd-ap-stat-val">{preview.lev}x</div></div>
                <div className="trd-ap-stat"><div className="trd-ap-stat-label">R:R</div><div className="trd-ap-stat-val" style={{ color: 'var(--accent-blue)' }}>{preview.rr}</div></div>
                <div className="trd-ap-stat" style={{ borderColor: 'rgba(251,191,36,0.3)' }}><div className="trd-ap-stat-label">@ 50% TP → SL to</div><div className="trd-ap-stat-val" style={{ color: '#fbbf24' }}>{preview.halfSlPrice}</div></div>
                <div className="trd-ap-stat" style={{ borderColor: 'rgba(251,191,36,0.3)' }}><div className="trd-ap-stat-label">@ 60% TP → SL to</div><div className="trd-ap-stat-val" style={{ color: '#fbbf24' }}>{preview.entry.toFixed(4)} (BE)</div></div>
              </div>
            </div>
          )}
          <button type="button" className="trd-ap-start-btn" disabled={!preview?.canStart} title={preview && !preview.canStart ? 'Position must have both SL and TP set' : ''} onClick={handleStart}>
            ▶ Start Autopilot SL Mode
          </button>
        </div>
      </div>
    </div>
  );
}
