import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import './Dashboard.css';

const fmt = (n, dec = 2) => Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtPnl = (n) => {
  const v = parseFloat(n) || 0;
  return (v >= 0 ? '+$' : '-$') + Math.abs(v).toFixed(2);
};

const SIDEBAR_ACTIONS = [
  { href: '/scanner', icon: 'fa-arrow-up-right-dots', label: 'Scanner' },
  { href: '/strategy', icon: 'fa-puzzle-piece', label: 'Strategy Builder' },
  { href: '/terminal', icon: 'fa-bolt', label: 'Trade' },
  { href: '/challenge', icon: 'fa-trophy', label: 'Prop Firm Challenge' },
  { href: '/setups', icon: 'fa-magnifying-glass', label: 'Scan Setups' },
];

const TABS = [
  { key: 'spot', label: 'Spot Assets', icon: 'fa-sack-dollar' },
  { key: 'futures', label: 'Futures Positions', icon: 'fa-chart-area' },
  { key: 'orders', label: 'Orders', icon: 'fa-clipboard' },
];

function BalanceCard({ balance, onRefresh }) {
  return (
    <div className="db-card">
      <div className="db-card-label">Available Balance</div>
      <div className="db-balance-val">{balance ? `$${fmt(balance.available)}` : '—'}</div>
      <div>
        <span className={`db-balance-mode ${balance?.mode === 'testnet' ? 'demo' : 'live'}`}>
          {balance ? (balance.mode === 'testnet' ? 'Demo' : 'Live') : '—'}
        </span>
      </div>
      <button className="db-refresh-btn" onClick={onRefresh}>↻ Refresh</button>
    </div>
  );
}

function PositionCard({ position }) {
  if (!position) {
    return (
      <div className="db-card">
        <div className="db-card-label">Open Position</div>
        <div className="db-pos-empty">No Open Position</div>
      </div>
    );
  }
  const pnl = parseFloat(position.unrealizedPnl) || 0;
  const pct = parseFloat(position.pnlPercent) || 0;
  const dir = (position.side || '').toLowerCase();
  const isLong = dir === 'buy' || dir === 'long';
  return (
    <div className="db-card">
      <div className="db-card-label">Open Position</div>
      <div>
        <span className="db-pos-sym">{position.symbol.replace('USDT', '')}</span>
        <span className={`db-pos-badge ${isLong ? 'long' : 'short'}`}>{isLong ? 'LONG' : 'SHORT'}</span>
      </div>
      <div className="db-pos-row">
        <div className="db-pos-stat"><label>Entry</label><span>${fmt(position.entryPrice, 4)}</span></div>
        <div className="db-pos-stat"><label>Mark</label><span>${fmt(position.markPrice, 4)}</span></div>
      </div>
      <div className="db-pnl-val" style={{ color: pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
        {fmtPnl(pnl)} <span style={{ fontSize: '0.78rem', opacity: 0.8 }}>({pnl >= 0 ? '+' : ''}{pct.toFixed(2)}%)</span>
      </div>
      <Link className="db-manage-btn" to="/terminal">Manage →</Link>
    </div>
  );
}

function SpotTab({ data }) {
  const coins = (data?.coins || [])
    .map((c) => ({
      ...c,
      _wallet: parseFloat(c.walletBalance || 0),
      _usd: parseFloat(c.usdValue || 0),
    }))
    .filter((c) => c._wallet > 0 || c._usd > 0)
    .sort((a, b) => b._usd - a._usd);

  if (!coins.length) return <div className="db-tab-empty">No spot assets found</div>;
  const total = coins.reduce((s, c) => s + c._usd, 0);

  return (
    <table className="db-tab-table">
      <thead>
        <tr><th>Asset</th><th>Wallet Balance</th><th>USD Value</th><th>Action</th></tr>
      </thead>
      <tbody>
        {coins.map((c) => (
          <tr key={c.coin}>
            <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{c.coin}</td>
            <td className="mono">{c._wallet.toFixed(6)}</td>
            <td className="mono" style={{ color: 'var(--blue)' }}>${c._usd.toFixed(2)}</td>
            <td>
              {c.coin !== 'USDT' ? (
                <Link className="db-row-action-btn" to={`/terminal?symbol=${encodeURIComponent(c.coin + 'USDT')}`}>Trade</Link>
              ) : (
                <button className="db-row-action-btn" disabled>—</button>
              )}
            </td>
          </tr>
        ))}
        <tr style={{ fontWeight: 700 }}>
          <td colSpan={3} style={{ color: 'var(--text-muted)' }}>Total</td>
          <td className="mono" style={{ color: 'var(--green)' }}>${total.toFixed(2)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function FuturesTab({ data }) {
  const positions = data?.positions || [];
  if (!positions.length) return <div className="db-tab-empty">No open futures positions</div>;
  return (
    <table className="db-tab-table">
      <thead>
        <tr><th>Symbol</th><th>Side</th><th>Size</th><th>Entry</th><th>Mark</th><th>PnL</th><th>Lev</th><th>Action</th></tr>
      </thead>
      <tbody>
        {positions.map((p) => {
          const pnl = parseFloat(p.unrealisedPnl || 0);
          const isLong = p.side === 'Buy';
          return (
            <tr key={p.symbol + p.side}>
              <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{p.symbol.replace('USDT', '')}</td>
              <td style={{ fontWeight: 700, color: isLong ? 'var(--green)' : 'var(--red)' }}>{isLong ? 'LONG' : 'SHORT'}</td>
              <td className="mono">{parseFloat(p.size).toFixed(4)}</td>
              <td className="mono">${parseFloat(p.avgPrice).toFixed(2)}</td>
              <td className="mono">${parseFloat(p.markPrice).toFixed(2)}</td>
              <td className={`mono pos-pnl ${pnl >= 0 ? 'profit' : 'loss'}`}>{fmtPnl(pnl)}</td>
              <td className="mono">{p.leverage}x</td>
              <td><Link className="db-row-action-btn" to="/terminal">Manage</Link></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function OrdersTab({ data }) {
  const orders = data?.orders || [];
  if (!orders.length) return <div className="db-tab-empty">No open orders</div>;
  return (
    <table className="db-tab-table">
      <thead>
        <tr><th>Symbol</th><th>Side</th><th>Type</th><th>Qty</th><th>Price</th><th>Status</th><th>Action</th></tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.orderId}>
            <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{o.symbol.replace('USDT', '')}</td>
            <td style={{ fontWeight: 700, color: o.side === 'Buy' ? 'var(--green)' : 'var(--red)' }}>{o.side === 'Buy' ? 'BUY' : 'SELL'}</td>
            <td>{o.orderType}</td>
            <td className="mono">{parseFloat(o.qty).toFixed(4)}</td>
            <td className="mono">${parseFloat(o.price || 0).toFixed(2)}</td>
            <td style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{o.orderStatus}</td>
            <td><Link className="db-row-action-btn" to="/terminal">Manage</Link></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Watchlist({ items }) {
  if (!items || !items.length) return <div className="db-wl-empty">No coins in watchlist.</div>;
  return (
    <>
      {items.map((c) => {
        const rsiCls = c.rsi < 35 ? 'rsi-low' : c.rsi > 65 ? 'rsi-high' : 'rsi-mid';
        const chgCls = c.change24h >= 0 ? 'chg-pos' : 'chg-neg';
        return (
          <div className="db-wl-row" key={c.symbol}>
            <div className="db-wl-sym">{c.symbol.replace('USDT', '')}<span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginLeft: 3 }}>USDT</span></div>
            <div className="db-wl-price">${c.price < 1 ? c.price.toFixed(5) : fmt(c.price, 2)}</div>
            <div className={`db-wl-rsi ${rsiCls}`}>RSI {c.rsi}</div>
            <div className={`db-wl-chg ${chgCls}`}>{c.change24h >= 0 ? '+' : ''}{c.change24h.toFixed(2)}%</div>
            <div className="db-wl-pos">
              {c.hasPosition && (
                <>
                  <span className="db-pos-pill">● IN POSITION</span>
                  <span className="db-wl-pnl" style={{ color: (c.positionPnl || 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtPnl(c.positionPnl)}</span>
                </>
              )}
            </div>
            <Link className="db-view-btn" to="/scanner">View</Link>
          </div>
        );
      })}
    </>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState('');
  const [activeTab, setActiveTab] = useState('spot');
  const [tabData, setTabData] = useState({});
  const [loadedTabs, setLoadedTabs] = useState({});
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const loadSummary = useCallback(async () => {
    try {
      const d = await api.get('/api/dashboard/summary');
      setSummary(d);
      setSummaryError('');
    } catch (e) {
      setSummaryError(e.message);
    }
  }, []);

  const loadTab = useCallback(async (tab) => {
    const endpoint = { spot: '/api/dashboard/spot-assets', futures: '/api/dashboard/futures-positions', orders: '/api/dashboard/orders' }[tab];
    try {
      const d = await api.get(endpoint);
      setTabData((prev) => ({ ...prev, [tab]: d }));
    } catch (e) {
      setTabData((prev) => ({ ...prev, [tab]: { error: e.message } }));
    }
  }, []);

  useEffect(() => {
    loadSummary();
    const id = setInterval(loadSummary, 10000);
    return () => clearInterval(id);
  }, [loadSummary]);

  useEffect(() => {
    if (!loadedTabs[activeTab]) {
      setLoadedTabs((prev) => ({ ...prev, [activeTab]: true }));
      loadTab(activeTab);
    }
  }, [activeTab, loadedTabs, loadTab]);

  return (
    <div className="db-layout">
      <div className={`db-sb-overlay${sidebarOpen ? ' open' : ''}`} onClick={() => setSidebarOpen(false)} />
      <div className={`db-sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sb-actions-title">Quick Actions</div>
        {SIDEBAR_ACTIONS.map((a) => (
          <Link key={a.href} className="sb-action-btn" to={a.href}>
            <span className="sb-action-icon"><i className={`fa-solid ${a.icon}`} /></span>{a.label}
          </Link>
        ))}
        <Link className="sb-action-btn" to="/settings" title="Settings"><i className="fa-solid fa-gear" /> Settings</Link>
      </div>

      <div className="db-main">
        <button className="db-sb-ham" onClick={() => setSidebarOpen((v) => !v)}>&#9776; Menu</button>

        <div className="db-welcome">Welcome, <span>{user?.firstName || 'there'}</span> 👋</div>

        <div className="db-section-title">Account Overview</div>
        <div className="db-overview-grid">
          <BalanceCard balance={summary?.balance} onRefresh={loadSummary} />
          <PositionCard position={summary?.openPosition} />
        </div>

        <div className="mainTabs">
          <div className="db-tabs-card">
            <div className="db-tab-bar">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  className={`db-tab-btn${activeTab === t.key ? ' active' : ''}`}
                  onClick={() => setActiveTab(t.key)}
                >
                  <i className={`fa-solid ${t.icon}`} /> {t.label}
                </button>
              ))}
            </div>
            <div className="db-tab-pane">
              {!loadedTabs[activeTab] || !tabData[activeTab] ? (
                <div className="db-tab-loading">Loading…</div>
              ) : tabData[activeTab].error ? (
                <div className="db-tab-empty" style={{ color: 'var(--red)' }}>Error: {tabData[activeTab].error}</div>
              ) : activeTab === 'spot' ? (
                <SpotTab data={tabData.spot} />
              ) : activeTab === 'futures' ? (
                <FuturesTab data={tabData.futures} />
              ) : (
                <OrdersTab data={tabData.orders} />
              )}
            </div>
          </div>

          <div className="db-watchlist-card">
            <div className="db-tab-bar db-section-title">Watchlist</div>
            {summaryError ? (
              <div className="db-wl-empty" style={{ color: 'var(--red)' }}>Failed to load: {summaryError}</div>
            ) : !summary ? (
              <div className="db-loading">Loading watchlist</div>
            ) : (
              <Watchlist items={summary.watchlist} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
