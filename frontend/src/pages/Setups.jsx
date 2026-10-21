import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { api, API_BASE } from '../api/client';
import { useAuth } from '../context/AuthContext';
import PremiumGate from '../components/PremiumGate';
import './Setups.css';

const RESULTS_KEY_BASE = 'setups_saved_results_v2';
const AI_KEY_BASE = 'setups_saved_ai_v2';

function scopedKey(base, userId) {
  const safe = String(userId || 'anon').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${base}_${safe}`;
}

function buildAIPrompt(signal) {
  return `You are an expert crypto futures technical analyst. Analyze ${signal.symbol} on 5m entry data.
Current price: ${signal.price}
Direction signal: ${signal.direction.toUpperCase()}
RSI (5m): ${signal.rsi5m}, ATR (5m): ${signal.atr5m}, 24h Volume: $${signal.volume}M

Respond ONLY in JSON:
{"direction":"LONG or SHORT or NEUTRAL","entry":<number>,"tp":<number>,"sl":<number>,"rr":"<e.g. 1:2.3>","confidence":"LOW or MEDIUM or HIGH","reasoning":"<4-6 sentences>"}`;
}

export default function Setups() {
  return (
    <PremiumGate>
      <SetupsContent />
    </PremiumGate>
  );
}

function SetupsContent() {
  const { user } = useAuth();
  const [signals, setSignals] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(null); // { step, percent }
  const [direction, setDirection] = useState('all');
  const [sort, setSort] = useState('rsi');
  const [expanded, setExpanded] = useState(() => new Set());
  const [aiCache, setAiCache] = useState(() => new Map());
  const socketRef = useRef(null);
  const resultsKey = scopedKey(RESULTS_KEY_BASE, user?._id);
  const aiKey = scopedKey(AI_KEY_BASE, user?._id);

  // Restore saved results/AI cache for this user.
  useEffect(() => {
    if (!user) return;
    try {
      const saved = localStorage.getItem(resultsKey);
      if (saved) setSignals(JSON.parse(saved) || []);
      const savedAI = JSON.parse(localStorage.getItem(aiKey) || '{}');
      setAiCache(new Map(Object.entries(savedAI)));
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?._id]);

  useEffect(() => {
    if (typeof window.io !== 'function') return;
    const sock = window.io(API_BASE || undefined, { withCredentials: true });
    socketRef.current = sock;

    sock.on('setups:start', ({ total }) => {
      setProgress({ step: `Scanning ${total} coins with hard filters…`, percent: 5 });
    });
    sock.on('setups:log', ({ message }) => {
      setProgress((p) => (p ? { ...p, step: message } : { step: message, percent: 10 }));
    });
    sock.on('setups:done', ({ candidates }) => {
      const list = candidates || [];
      setSignals(list);
      try { localStorage.setItem(resultsKey, JSON.stringify(list)); } catch { /* ignore */ }
      setProgress({ step: `Scan complete! Found ${list.length} candidates`, percent: 100 });
      setTimeout(() => setProgress(null), 800);
      setScanning(false);
    });

    return () => sock.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultsKey]);

  async function startScan() {
    setScanning(true);
    setExpanded(new Set());
    setProgress({ step: 'Starting scan...', percent: 0 });
    try {
      const data = await api.post('/api/scan/setups', {});
      if (data?.ok === false) {
        setProgress({ step: `Error: ${data.error || 'Scan failed'}`, percent: 0 });
        setScanning(false);
      }
    } catch (e) {
      setProgress({ step: `Error: ${e.message}`, percent: 0 });
      setScanning(false);
    }
  }

  function clearResults() {
    setSignals([]);
    setExpanded(new Set());
    setAiCache(new Map());
    try {
      localStorage.removeItem(resultsKey);
      localStorage.removeItem(aiKey);
    } catch { /* ignore */ }
  }

  function toggleRow(symbol) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol); else next.add(symbol);
      return next;
    });
  }

  const runRowAI = useCallback(async (symbol) => {
    const signal = signals.find((s) => s.symbol === symbol);
    if (!signal) return;
    setAiCache((prev) => new Map(prev).set(symbol, { loading: true }));
    try {
      const prompt = buildAIPrompt(signal);
      const data = await api.post('/api/ai/analyze', { prompt });
      if (!data.ok) throw new Error(data.error || 'AI analysis failed');
      const cleaned = (data.result || '').replace(/```json|```/gi, '').trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      const result = JSON.parse(match ? match[0] : cleaned);
      setAiCache((prev) => {
        const next = new Map(prev).set(symbol, { loading: false, result });
        try {
          const obj = Object.fromEntries(next);
          localStorage.setItem(aiKey, JSON.stringify(obj));
        } catch { /* ignore */ }
        return next;
      });
    } catch (e) {
      setAiCache((prev) => new Map(prev).set(symbol, { loading: false, error: e.message }));
    }
  }, [signals, aiKey]);

  function openTrade(symbol) {
    window.location.href = `/terminal?sym=${symbol}`;
  }

  let filtered = signals;
  if (direction !== 'all') filtered = filtered.filter((s) => s.direction.toUpperCase() === direction);
  filtered = [...filtered].sort((a, b) => {
    if (sort === 'rsi') return b.rsi5m - a.rsi5m;
    if (sort === 'price') return b.price - a.price;
    if (sort === 'volume') return b.volume - a.volume;
    return a.symbol.localeCompare(b.symbol);
  });

  const hasAny = signals.length > 0;

  return (
    <div className="wrap">
      <div className="page-header">
        <div className="page-title">Setup Scanner</div>
        <div className="page-sub">Hard-filter scan of your configured coin list for RSI/ATR-based long/short candidates</div>
      </div>

      <div className="controls-bar">
        <button className="scan-btn" disabled={scanning} onClick={startScan}>
          {scanning ? 'Scanning…' : 'Run Scanner'}
        </button>
        <button className="scan-btn scan-btn-secondary" onClick={clearResults}>Clear Results</button>
      </div>

      {progress && (
        <div className="progress-wrap">
          <div className="progress-step">{progress.step}</div>
          <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress.percent}%` }} /></div>
          <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'right' }}>{progress.percent}%</div>
        </div>
      )}

      {hasAny && (
        <div className="filters-row">
          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>Direction:</div>
          {['all', 'LONG', 'SHORT'].map((d) => (
            <button key={d} className={`filter-btn${direction === d ? ' active' : ''}`} onClick={() => setDirection(d)}>{d === 'all' ? 'All' : d}</button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>Sort:</div>
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="sort-select">
              <option value="rsi">RSI (5m)</option>
              <option value="price">Price</option>
              <option value="volume">Volume</option>
              <option value="symbol">Symbol</option>
            </select>
          </div>
          <div className="results-count">Showing {filtered.length} candidates</div>
        </div>
      )}

      <div className="signals-grid">
        {filtered.length > 0 && (
          <table className="signals-table">
            <thead>
              <tr><th>Symbol</th><th>Dir</th><th>RSI (5m)</th><th>ATR (5m)</th><th>Price</th><th>Vol ($M)</th></tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const cached = aiCache.get(s.symbol);
                const isOpen = expanded.has(s.symbol);
                return (
                  <Fragment key={s.symbol}>
                    <tr className={`basic-row${isOpen ? ' open' : ''}`} onClick={() => toggleRow(s.symbol)}>
                      <td>{s.symbol.replace('USDT', '')}</td>
                      <td className={s.direction === 'long' ? 'dir-long' : 'dir-short'}>{s.direction.toUpperCase()}</td>
                      <td>{s.rsi5m}</td>
                      <td>{s.atr5m}</td>
                      <td>{s.price}</td>
                      <td>{s.volume}</td>
                    </tr>
                    {isOpen && (
                      <tr className="ai-expand-row">
                        <td colSpan={6}>
                          <AiPanel symbol={s.symbol} cached={cached} onAnalyze={runRowAI} onTrade={openTrade} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
        {filtered.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon"><i className="fa-solid fa-magnifying-glass" /></div>
            <div className="empty-text">{hasAny ? 'No candidates match current filters' : 'No candidates found'}</div>
            <div className="empty-sub">{hasAny ? 'Try changing the Direction filter' : 'Run a scan to find trading candidates'}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function AiPanel({ symbol, cached, onAnalyze, onTrade }) {
  if (!cached) {
    return (
      <div className="ai-panel">
        <div style={{ color: 'var(--text-muted)' }}>Click &quot;Analyze with AI&quot; to analyze this candidate.</div>
        <div className="table-actions">
          <button className="action-btn" onClick={(e) => { e.stopPropagation(); onAnalyze(symbol); }}>Analyze with AI</button>
          <button className="action-btn primary" onClick={(e) => { e.stopPropagation(); onTrade(symbol); }}>Trade</button>
        </div>
      </div>
    );
  }
  if (cached.loading) {
    return (
      <div className="ai-panel">
        <span className="spinner" /> <span style={{ color: 'var(--text-muted)', marginLeft: '0.4rem' }}>Analyzing...</span>
        <div className="table-actions">
          <button className="action-btn" disabled>Analyzing...</button>
          <button className="action-btn primary" onClick={(e) => { e.stopPropagation(); onTrade(symbol); }}>Trade</button>
        </div>
      </div>
    );
  }
  if (cached.error) {
    return (
      <div className="ai-panel">
        <div style={{ color: 'var(--red)' }}>Error: {cached.error}</div>
        <div className="table-actions">
          <button className="action-btn" onClick={(e) => { e.stopPropagation(); onAnalyze(symbol); }}>Analyze with AI</button>
          <button className="action-btn primary" onClick={(e) => { e.stopPropagation(); onTrade(symbol); }}>Trade</button>
        </div>
      </div>
    );
  }
  const r = cached.result || {};
  const dirColor = r.direction === 'LONG' ? 'var(--green)' : r.direction === 'SHORT' ? 'var(--red)' : 'var(--amber)';
  return (
    <div className="ai-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 800, color: dirColor }}>{r.direction || 'NEUTRAL'}</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{r.confidence || ''}</div>
      </div>
      <div className="ai-grid">
        <div className="ai-box"><div className="ai-box-label">Entry</div><div className="ai-box-value">{r.entry ?? '—'}</div></div>
        <div className="ai-box"><div className="ai-box-label">SL</div><div className="ai-box-value" style={{ color: 'var(--red)' }}>{r.sl ?? '—'}</div></div>
        <div className="ai-box"><div className="ai-box-label">TP</div><div className="ai-box-value" style={{ color: 'var(--green)' }}>{r.tp ?? '—'}</div></div>
        <div className="ai-box"><div className="ai-box-label">R:R</div><div className="ai-box-value">{r.rr ?? '—'}</div></div>
      </div>
      <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>{r.reasoning || ''}</div>
      <div className="table-actions">
        <button className="action-btn" onClick={(e) => { e.stopPropagation(); onAnalyze(symbol); }}>Analyze with AI</button>
        <button className="action-btn primary" onClick={(e) => { e.stopPropagation(); onTrade(symbol); }}>Trade</button>
      </div>
    </div>
  );
}
