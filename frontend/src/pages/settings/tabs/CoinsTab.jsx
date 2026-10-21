import { useEffect, useRef, useState } from 'react';
import { api } from '../../../api/client';
import { DEFAULT_SYMBOLS, UNIVERSE } from '../constants';

export default function CoinsTab() {
  const [symbols, setSymbols] = useState([]);
  const [query, setQuery] = useState('');
  const loaded = useRef(false);

  useEffect(() => {
    api.get('/api/settings').then((s) => {
      setSymbols(s.symbols && s.symbols.length ? s.symbols : [...DEFAULT_SYMBOLS]);
      loaded.current = true;
    }).catch(() => { setSymbols([...DEFAULT_SYMBOLS]); loaded.current = true; });
  }, []);

  // Persist whenever the selection changes, after the initial load.
  useEffect(() => {
    if (!loaded.current) return;
    api.post('/api/settings', { symbols }).catch(() => {});
  }, [symbols]);

  function toggle(sym, checked) {
    setSymbols((s) => (checked ? [...s, sym] : s.filter((x) => x !== sym)));
  }

  const q = query.toUpperCase().replace('USDT', '');
  const filtered = q ? UNIVERSE.filter((s) => s.replace('USDT', '').includes(q)) : UNIVERSE;

  return (
    <div className="sp-card" style={{ maxWidth: 500 }}>
      <div className="sp-card-title">Active Coins &nbsp;<span style={{ color: '#29ffb8', fontWeight: 700 }}>({symbols.length}/{UNIVERSE.length})</span></div>
      <div className="coin-list-wrap">
        <input className="coin-list-search" placeholder="Filter coins…" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="coin-list-actions">
          <button onClick={() => setSymbols([...UNIVERSE])}>Select All</button>
          <button onClick={() => { if (window.confirm('Deselect all coins?')) setSymbols([]); }}>Deselect All</button>
          <button onClick={() => setSymbols([...DEFAULT_SYMBOLS])}>Reset Default</button>
        </div>
        <div className="coin-list">
          {filtered.map((sym) => {
            const checked = symbols.includes(sym);
            const base = sym.replace('USDT', '');
            return (
              <label className="coin-row" key={sym}>
                <input type="checkbox" checked={checked} onChange={(e) => toggle(sym, e.target.checked)} />
                <span className="coin-row-sym">{base}</span><span className="coin-row-base">/USDT</span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
