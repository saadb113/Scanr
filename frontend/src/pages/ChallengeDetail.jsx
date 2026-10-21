import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Chart from 'chart.js/auto';
import { api } from '../api/client';
import Pagination from '../components/Pagination';
import { useExternalScript } from '../utils/useExternalScript';
import './ChallengeDetail.css';

const fmt2 = (n) => (n >= 0 ? '+$' : '-$') + Math.abs(n).toFixed(2);
const BADGE_LABELS = { active: 'ACTIVE', 'on-track': '✅ ON TRACK', 'at-risk': '⚠️ AT RISK', passed: '✅ PASSED', failed: '❌ FAILED' };
const PER_PAGE = 10;

function computeDisplayStatus(c) {
  if (c.status === 'passed' || c.status === 'failed') return c.status;
  const target = c.accountSize * (c.profitTargetPct / 100);
  const maxDD = c.accountSize * (c.maxTotalDrawdownPct / 100);
  const maxDayDD = c.accountSize * (c.maxDailyDrawdownPct / 100);
  if ((c.totalPnl || 0) >= target) return 'passed';
  if (-(c.dailyDrawdown || 0) >= maxDayDD) return 'failed';
  if (-(c.totalDrawdown || 0) >= maxDD) return 'failed';
  const totalDDPct = maxDD > 0 ? (-(c.totalDrawdown || 0) / maxDD) * 100 : 0;
  const dailyDDPct = maxDayDD > 0 ? (-(c.dailyDrawdown || 0) / maxDayDD) * 100 : 0;
  if (totalDDPct > 70 || dailyDDPct > 70) return 'at-risk';
  return 'on-track';
}

// The legacy page called a non-existent `/api/proxy/binance` endpoint for price
// previews (dead route, silently swallowed by try/catch). Binance's futures
// ticker is a public, unauthenticated, CORS-enabled endpoint, so we call it
// directly from the browser instead of reproducing that dead proxy call.
async function fetchBinancePrice(symbol) {
  const r = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`);
  const d = await r.json();
  return d?.price ? parseFloat(d.price) : null;
}

function Metrics({ challenge }) {
  const c = challenge;
  const target = c.accountSize * (c.profitTargetPct / 100);
  const maxDD = c.accountSize * (c.maxTotalDrawdownPct / 100);
  const maxDayDD = c.accountSize * (c.maxDailyDrawdownPct / 100);

  const profitPct = target > 0 ? Math.min(100, Math.max(0, ((c.totalPnl || 0) / target) * 100)) : 0;
  const totalDDPct = maxDD > 0 ? Math.min(100, (-(c.totalDrawdown || 0) / maxDD) * 100) : 0;
  const dailyDDPct = maxDayDD > 0 ? Math.min(100, (-(c.dailyDrawdown || 0) / maxDayDD) * 100) : 0;

  const pC = profitPct >= 100 ? 'var(--green)' : 'var(--blue)';
  const tC = totalDDPct > 70 ? 'var(--red)' : totalDDPct > 40 ? 'var(--amber)' : 'var(--text-muted)';
  const dC = dailyDDPct > 70 ? 'var(--red)' : dailyDDPct > 40 ? 'var(--amber)' : 'var(--text-muted)';

  const endDt = new Date(c.startDate);
  endDt.setDate(endDt.getDate() + (c.durationDays || 30));
  const daysLeft = Math.max(0, Math.ceil((endDt - new Date()) / 86400000));

  return (
    <div className="cd-metrics">
      <div className="cd-meter">
        <div className="cd-meter-lbl"><span>Profit Progress</span><span>{fmt2(c.totalPnl || 0)} / ${target.toFixed(0)}</span></div>
        <div className="cd-bar-bg"><div className="cd-bar-fill" style={{ width: `${profitPct}%`, background: pC }} /></div>
      </div>
      <div className="cd-meter">
        <div className="cd-meter-lbl"><span>Daily Drawdown</span><span>{dailyDDPct.toFixed(1)}% used</span></div>
        <div className="cd-bar-bg"><div className="cd-bar-fill" style={{ width: `${dailyDDPct}%`, background: dC }} /></div>
      </div>
      <div className="cd-meter">
        <div className="cd-meter-lbl"><span>Total Drawdown</span><span>{totalDDPct.toFixed(1)}% used</span></div>
        <div className="cd-bar-bg"><div className="cd-bar-fill" style={{ width: `${totalDDPct}%`, background: tC }} /></div>
      </div>
      <div className="cd-days-chip">{daysLeft}<small>days left</small></div>
    </div>
  );
}

function TVChart({ symbol }) {
  const ready = useExternalScript('https://s3.tradingview.com/tv.js');
  const containerRef = useRef(null);
  const widgetRef = useRef(null);

  useEffect(() => {
    if (!ready || !window.TradingView) return;
    if (widgetRef.current) {
      try { widgetRef.current.remove(); } catch { /* ignore */ }
    }
    widgetRef.current = new window.TradingView.widget({
      container_id: containerRef.current.id,
      symbol,
      interval: '5',
      theme: 'dark',
      style: '1',
      hide_side_toolbar: false,
      allow_symbol_change: true,
      height: 480,
      width: '100%',
      locale: 'en',
      toolbar_bg: '#0d1117',
      withdateranges: true,
      save_image: false,
    });
  }, [ready, symbol]);

  return <div className="cd-chart-wrap"><div id="tv-chart" ref={containerRef} /></div>;
}

function PnlChart({ data }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!data) return;
    const labels = data.map((d) => d.date.slice(5));
    const vals = data.map((d) => d.pnl);
    const running = data.map((d) => d.running);
    const colors = vals.map((v) => (v >= 0 ? 'rgba(0,229,160,0.7)' : 'rgba(255,77,106,0.7)'));
    const borderC = vals.map((v) => (v >= 0 ? '#00e5a0' : '#ff4d6a'));

    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current.getContext('2d'), {
      data: {
        labels,
        datasets: [
          { type: 'bar', label: 'Daily PnL', data: vals, backgroundColor: colors, borderColor: borderC, borderWidth: 1, borderRadius: 3, yAxisID: 'y' },
          { type: 'line', label: 'Running Total', data: running, borderColor: '#4da8ff', borderWidth: 2, pointRadius: 2, fill: false, tension: 0.3, yAxisID: 'y' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#9aa3b5', font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: '#5a6478', font: { size: 10 } }, grid: { color: '#1c2435' } },
          y: { ticks: { color: '#9aa3b5', font: { size: 10 }, callback: (v) => `$${v.toFixed(0)}` }, grid: { color: '#1c2435' } },
        },
      },
    });
    return () => chartRef.current?.destroy();
  }, [data]);

  return <div className="cd-pnl-chart"><canvas ref={canvasRef} /></div>;
}

function OpenPositionsTab({ trades, priceMap, onClose }) {
  const [page, setPage] = useState(1);
  if (!trades.length) return <div className="cd-tbl-empty">No open positions</div>;
  const slice = trades.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  return (
    <>
      <table className="cd-tbl">
        <thead>
          <tr><th>Symbol</th><th>Side</th><th>Size</th><th>Entry</th><th>Current</th><th>Unr. PnL</th><th>SL</th><th>TP</th><th /></tr>
        </thead>
        <tbody>
          {slice.map((t) => {
            const cur = priceMap[t.symbol] || t.entryPrice;
            const dir = t.side === 'long' ? 1 : -1;
            const upnl = ((cur - t.entryPrice) / t.entryPrice) * t.quantity * (t.leverage || 1) * dir;
            return (
              <tr key={t._id}>
                <td className="mono">{t.symbol}</td>
                <td className={`side-${t.side}`}>{t.side.toUpperCase()}</td>
                <td className="mono">${parseFloat(t.quantity).toFixed(2)}</td>
                <td className="mono">{parseFloat(t.entryPrice).toFixed(4)}</td>
                <td className="mono">{cur.toFixed(4)}</td>
                <td className={`mono ${upnl >= 0 ? 'green' : 'red'}`}>{fmt2(upnl)}</td>
                <td className="mono">{t.sl ? parseFloat(t.sl).toFixed(4) : '—'}</td>
                <td className="mono">{t.tp ? parseFloat(t.tp).toFixed(4) : '—'}</td>
                <td><button className="cd-close-btn" onClick={() => onClose(t._id)}>Close</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Pagination page={page} perPage={PER_PAGE} total={trades.length} onChange={setPage} />
    </>
  );
}

function HistoryTab({ trades }) {
  const [page, setPage] = useState(1);
  if (!trades.length) return <div className="cd-tbl-empty">No closed trades yet</div>;
  const slice = trades.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  return (
    <>
      <table className="cd-tbl">
        <thead>
          <tr><th>Date</th><th>Symbol</th><th>Side</th><th>Entry</th><th>Exit</th><th>PnL</th><th>RR</th><th>Result</th></tr>
        </thead>
        <tbody>
          {slice.map((t) => {
            const pnl = parseFloat(t.pnl) || 0;
            const dt = t.closedAt ? new Date(t.closedAt).toLocaleDateString() : '—';
            return (
              <tr key={t._id}>
                <td>{dt}</td>
                <td className="mono">{t.symbol}</td>
                <td className={`side-${t.side}`}>{t.side.toUpperCase()}</td>
                <td className="mono">{parseFloat(t.entryPrice).toFixed(4)}</td>
                <td className="mono">{t.exitPrice ? parseFloat(t.exitPrice).toFixed(4) : '—'}</td>
                <td className={`mono ${pnl >= 0 ? 'green' : 'red'}`}>{fmt2(pnl)}</td>
                <td className="mono">{t.rrAchieved ? `${t.rrAchieved}:1` : '—'}</td>
                <td>{pnl >= 0 ? <span className="cd-win-badge">WIN</span> : <span className="cd-loss-badge">LOSS</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Pagination page={page} perPage={PER_PAGE} total={trades.length} onChange={setPage} />
    </>
  );
}

function OrderForm({ challengeId, onPlaced, onSymbolChange }) {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [side, setSide] = useState('long');
  const [orderType, setOrderType] = useState('market');
  const [qty, setQty] = useState('');
  const [leverage, setLeverage] = useState(1);
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [previewPrice, setPreviewPrice] = useState(null);
  const [placing, setPlacing] = useState(false);
  const [msg, setMsg] = useState(null);

  // Debounced price preview whenever the symbol changes.
  useEffect(() => {
    const sym = symbol.trim().toUpperCase();
    if (sym.length < 3) return;
    const id = setTimeout(() => {
      fetchBinancePrice(sym).then((p) => { if (p) setPreviewPrice(p); }).catch(() => {});
      onSymbolChange?.(sym);
    }, 600);
    return () => clearTimeout(id);
  }, [symbol, onSymbolChange]);

  useEffect(() => {
    if (msg === null) return;
    const id = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(id);
  }, [msg]);

  const slNum = parseFloat(sl);
  const tpNum = parseFloat(tp);
  let rrText = previewPrice ? '—' : 'fetching price…';
  let rrColor = 'var(--text-muted)';
  if (slNum && tpNum && previewPrice) {
    const slDist = Math.abs(previewPrice - slNum);
    const tpDist = Math.abs(tpNum - previewPrice);
    if (slDist > 0) {
      const rr = (tpDist / slDist).toFixed(2);
      rrText = `${rr}:1  (entry ≈ $${previewPrice.toFixed(4)})`;
      rrColor = parseFloat(rr) >= 1 ? 'var(--green)' : 'var(--amber)';
    }
  }

  async function handlePlace() {
    const sym = symbol.trim().toUpperCase();
    const qtyNum = parseFloat(qty);
    if (!sym) return setMsg({ text: '✗ Symbol required', color: 'var(--red)' });
    if (!qtyNum || qtyNum < 1) return setMsg({ text: '✗ Quantity required', color: 'var(--red)' });
    if (!slNum) return setMsg({ text: '✗ Stop loss required', color: 'var(--red)' });
    if (!tpNum) return setMsg({ text: '✗ Take profit required', color: 'var(--red)' });

    setPlacing(true);
    try {
      const d = await api.post(`/api/challenge/${challengeId}/trade/place`, {
        symbol: sym, side, orderType, quantity: qtyNum, leverage, sl: slNum, tp: tpNum,
      });
      setMsg({ text: `✓ Trade placed @ $${parseFloat(d.trade.entryPrice).toFixed(4)}`, color: 'var(--green)' });
      setQty(''); setSl(''); setTp('');
      await onPlaced();
    } catch (e) {
      setMsg({ text: `✗ ${e.message}`, color: 'var(--red)' });
    } finally {
      setPlacing(false);
    }
  }

  return (
    <div className="cd-sidebar">
      <div className="cd-sidebar-title">Place Trade</div>

      <div className="cd-field">
        <label>Symbol</label>
        <input type="text" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
      </div>

      <div className="cd-side-btns">
        <button className={`cd-long-btn${side === 'long' ? ' active' : ''}`} onClick={() => setSide('long')}>▲ LONG</button>
        <button className={`cd-short-btn${side === 'short' ? ' active' : ''}`} onClick={() => setSide('short')}>▼ SHORT</button>
      </div>

      <div className="cd-type-row">
        <button className={`cd-type-btn${orderType === 'market' ? ' active' : ''}`} onClick={() => setOrderType('market')}>Market</button>
        <button className={`cd-type-btn${orderType === 'limit' ? ' active' : ''}`} onClick={() => setOrderType('limit')}>Limit</button>
      </div>

      <div className="cd-field">
        <label>Quantity (USDT)</label>
        <input type="number" placeholder="100" min="1" value={qty} onChange={(e) => setQty(e.target.value)} />
      </div>

      <div className="cd-field">
        <label>Leverage — <span>{leverage}</span>x</label>
        <div className="cd-lev-row">
          <input type="range" min="1" max="125" value={leverage} onChange={(e) => setLeverage(parseInt(e.target.value, 10))} />
        </div>
      </div>

      <div className="cd-field">
        <label>Stop Loss</label>
        <input type="number" placeholder="0.00" step="any" value={sl} onChange={(e) => setSl(e.target.value)} />
      </div>

      <div className="cd-field">
        <label>Take Profit</label>
        <input type="number" placeholder="0.00" step="any" value={tp} onChange={(e) => setTp(e.target.value)} />
      </div>

      <div className="cd-field">
        <label>Risk:Reward</label>
        <div className="cd-rr-display" style={{ color: rrColor }}>{rrText}</div>
      </div>

      <button className={`cd-place-btn ${side}`} disabled={placing} onClick={handlePlace}>
        {side === 'long' ? '▲ Place Long' : '▼ Place Short'}
      </button>
      {msg && <div className="cd-place-msg" style={{ color: msg.color }}>{msg.text}</div>}
    </div>
  );
}

export default function ChallengeDetail() {
  const { id } = useParams();
  const [challenge, setChallenge] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('open');
  const [openTrades, setOpenTrades] = useState([]);
  const [openPriceMap, setOpenPriceMap] = useState({});
  const [historyTrades, setHistoryTrades] = useState([]);
  const [dailyPnl, setDailyPnl] = useState(null);
  const [chartSymbol, setChartSymbol] = useState('BTCUSDT');

  const loadTrades = useCallback(async () => {
    const d = await api.get(`/api/challenge/${id}/trades`);
    if (!d.ok) return;
    setOpenTrades(d.trades.filter((t) => t.status === 'open'));
    setHistoryTrades(d.trades.filter((t) => t.status === 'closed'));
  }, [id]);

  const refreshOpenPositions = useCallback(async () => {
    const d = await api.get(`/api/challenge/${id}/trades/open`);
    if (!d.ok) return;
    setOpenTrades(d.trades);
    const symbols = [...new Set(d.trades.map((t) => t.symbol))];
    const priceMap = {};
    await Promise.all(symbols.map(async (sym) => {
      const p = await fetchBinancePrice(sym).catch(() => null);
      if (p) priceMap[sym] = p;
    }));
    setOpenPriceMap(priceMap);
  }, [id]);

  const loadDailyPnl = useCallback(async () => {
    const d = await api.get(`/api/challenge/${id}/daily-pnl`);
    if (d.ok) setDailyPnl(d.data);
  }, [id]);

  useEffect(() => {
    let poller;
    (async () => {
      try {
        const d = await api.get(`/api/challenge/${id}`);
        if (!d.ok) throw new Error(d.error || 'Failed to load');
        setChallenge(d.challenge);
        await loadTrades();
        poller = setInterval(refreshOpenPositions, 10000);
      } catch (e) {
        setError(e.message);
      }
    })();
    return () => clearInterval(poller);
  }, [id, loadTrades, refreshOpenPositions]);

  function switchTab(next) {
    setTab(next);
    if (next === 'pnl') loadDailyPnl();
    if (next === 'open') refreshOpenPositions();
    if (next === 'history') loadTrades();
  }

  async function handleClose(tradeId) {
    if (!window.confirm('Close this position at market price?')) return;
    try {
      const d = await api.post(`/api/challenge/${id}/trade/close`, { tradeId });
      if (!d.ok) throw new Error(d.error || 'Close failed');
      if (d.metrics) setChallenge((c) => ({ ...c, ...d.metrics }));
      await loadTrades();
      loadDailyPnl();
    } catch (e) {
      window.alert(`Close failed: ${e.message}`);
    }
  }

  if (error) return <div className="cd-loading"><span style={{ color: 'var(--red)' }}>Failed to load: {error}</span></div>;
  if (!challenge) return <div className="cd-loading">Loading challenge…</div>;

  const dispStatus = computeDisplayStatus(challenge);

  return (
    <div className="cd-page">
      <div className="cd-toprow">
        <Link className="cd-back" to="/challenge">← Challenges</Link>
        <div className="cd-title">{challenge.title} — ${(challenge.accountSize || 0).toLocaleString()}</div>
        <span className={`cd-badge ${dispStatus === 'active' ? 'active' : dispStatus}`}>{BADGE_LABELS[dispStatus] || dispStatus.toUpperCase()}</span>
      </div>

      <Metrics challenge={challenge} />

      <div className="cd-layout">
        <div className="cd-left">
          <TVChart symbol={chartSymbol} />

          <div className="cd-tabs">
            <button className={`cd-tab${tab === 'open' ? ' active' : ''}`} onClick={() => switchTab('open')}>Open Positions</button>
            <button className={`cd-tab${tab === 'history' ? ' active' : ''}`} onClick={() => switchTab('history')}>Trade History</button>
            <button className={`cd-tab${tab === 'pnl' ? ' active' : ''}`} onClick={() => switchTab('pnl')}>Daily PnL</button>
          </div>

          <div className={`cd-tab-content${tab === 'open' ? ' active' : ''}`}>
            {tab === 'open' && <OpenPositionsTab trades={openTrades} priceMap={openPriceMap} onClose={handleClose} />}
          </div>
          <div className={`cd-tab-content${tab === 'history' ? ' active' : ''}`}>
            {tab === 'history' && <HistoryTab trades={historyTrades} />}
          </div>
          <div className={`cd-tab-content${tab === 'pnl' ? ' active' : ''}`}>
            {tab === 'pnl' && <PnlChart data={dailyPnl} />}
          </div>
        </div>

        <OrderForm
          challengeId={id}
          onPlaced={async () => { await loadTrades(); setTab('open'); await refreshOpenPositions(); }}
          onSymbolChange={setChartSymbol}
        />
      </div>
    </div>
  );
}
