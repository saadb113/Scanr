import { useCallback, useEffect, useState } from 'react';
import { bybitRequest } from '../../utils/bybit';

// Open (pending) Bybit orders tab. Ported from bytLoadOrders()/cdLoadOrders().
// Coin-Detail's version never offered a "modify order" action in its markup
// (only Cancel) — `allowModify` lets Terminal show Edit while Coin-Detail
// doesn't, so each page faithfully matches its own prior behavior.
export default function OrdersList({ creds, clockOffset, category, allowModify = false, onModify, onCountChange, onCancelled }) {
  const [state, setState] = useState({ loading: true, error: null, orders: [] });

  const load = useCallback(async () => {
    if (!creds?.apiKey) {
      setState({ loading: false, error: null, orders: [] });
      onCountChange?.(0);
      return;
    }
    try {
      const params = category === 'spot' ? { category: 'spot' } : { category: 'linear', settleCoin: 'USDT' };
      const r = await bybitRequest(creds, 'GET', '/v5/order/realtime', params, null, clockOffset);
      if (r.retCode !== 0) { setState({ loading: false, error: r.retMsg, orders: [] }); return; }
      const orders = r.result?.list || [];
      setState({ loading: false, error: null, orders });
      onCountChange?.(orders.length);
    } catch (e) {
      setState({ loading: false, error: e.message, orders: [] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creds?.apiKey, creds?.apiSecret, creds?.env, category, clockOffset]);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  async function cancelOrder(orderId, sym) {
    if (!window.confirm(`Cancel order ${orderId.slice(0, 8)}…?`)) return;
    try {
      const res = await bybitRequest(creds, 'POST', '/v5/order/cancel', null, { category, symbol: sym, orderId }, clockOffset);
      if (res.retCode === 0) { onCancelled?.('Order cancelled'); setTimeout(load, 800); }
      else onCancelled?.(res.retMsg, true);
    } catch (e) { onCancelled?.(e.message, true); }
  }

  if (!creds?.apiKey) return <div className="trd-empty">No API credentials — add them in Settings → Bybit.</div>;
  if (state.loading) return <div className="trd-empty">Loading…</div>;
  if (state.error) return <div className="trd-empty trd-error">✗ {state.error}</div>;
  if (!state.orders.length) return <div className="trd-empty">No open orders</div>;

  return (
    <>
      {state.orders.map((o) => {
        const isLong = o.side === 'Buy';
        return (
          <div key={o.orderId} className="trd-ord-card">
            <div className="trd-ord-info">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="trd-ord-sym">{o.symbol}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: isLong ? 'var(--accent-green)' : 'var(--accent-red)' }}>{isLong ? '▲ LONG' : '▼ SHORT'}</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{o.orderType}</span>
              </div>
              <div className="trd-ord-detail">
                Price: {parseFloat(o.price) > 0 ? o.price : 'Market'} · Qty: {o.qty}
                {parseFloat(o.stopLoss) > 0 && <> · SL: <span style={{ color: 'var(--accent-red)' }}>{o.stopLoss}</span></>}
                {parseFloat(o.takeProfit) > 0 && <> · TP: <span style={{ color: 'var(--accent-green)' }}>{o.takeProfit}</span></>}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{o.orderStatus} · {new Date(parseInt(o.createdTime, 10)).toLocaleTimeString()}</div>
            </div>
            <div className="trd-ord-actions">
              {allowModify && (
                <button type="button" className="trd-act-btn modify" onClick={() => onModify?.(o)}>Edit</button>
              )}
              <button type="button" className="trd-act-btn close" onClick={() => cancelOrder(o.orderId, o.symbol)}>✗ Cancel</button>
            </div>
          </div>
        );
      })}
    </>
  );
}
