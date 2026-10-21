import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api/client';

// The source page had a "Drawings" tab (list + "Clear All" button) with zero JS behind
// it anywhere — no fetch to /api/drawings, no click handler, nothing. The backend route
// fully supports listing and clearing per-symbol drawings, so this implements the tab
// for real instead of porting an empty shell.
export default function DrawingsTab() {
  const [drawings, setDrawings] = useState(null);

  const load = useCallback(() => {
    api.get('/api/drawings').then((d) => setDrawings(d || {})).catch(() => setDrawings({}));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function clearSymbol(sym) {
    await api.del(`/api/drawings/${encodeURIComponent(sym)}`);
    load();
  }

  async function clearAll() {
    if (!drawings || !Object.keys(drawings).length) return;
    if (!window.confirm('Clear ALL drawings from ALL coins? This cannot be undone.')) return;
    await Promise.all(Object.keys(drawings).map((sym) => api.del(`/api/drawings/${encodeURIComponent(sym)}`)));
    load();
  }

  const symbols = drawings ? Object.keys(drawings) : [];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ fontSize: '0.92rem', color: '#6b7897' }}>Coins with saved drawings across all timeframes</div>
        <button
          onClick={clearAll}
          style={{ background: '#1a0f0f', border: '1px solid rgba(245,101,101,0.3)', color: '#f56565', borderRadius: 7, padding: '0.38rem 1rem', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' }}
        >
          🗑 Clear All Drawings
        </button>
      </div>

      {!drawings ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#2e3a55', fontSize: 15 }}>Loading…</div>
      ) : !symbols.length ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#2e3a55', fontSize: 15 }}>
          ✏️<br /><br />No saved drawings yet.<br /><span style={{ fontSize: 13 }}>Open a coin, draw something, and it'll appear here.</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {symbols.map((sym) => {
            const timeframes = Object.keys(drawings[sym] || {});
            return (
              <div key={sym} className="sp-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem' }}>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{sym.replace('USDT', '')}<span style={{ color: 'var(--text-muted)', fontSize: 12 }}>/USDT</span></div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{timeframes.join(', ') || '—'}</div>
                </div>
                <button
                  onClick={() => clearSymbol(sym)}
                  style={{ background: '#1a0f0f', border: '1px solid rgba(245,101,101,0.3)', color: '#f56565', borderRadius: 6, padding: '0.3rem 0.7rem', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Clear
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
