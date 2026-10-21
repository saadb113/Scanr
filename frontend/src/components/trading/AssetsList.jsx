import { useCallback, useEffect, useState } from 'react';
import { bybitRequest } from '../../utils/bybit';

// Wallet balances tab. Ported from bytLoadAssets()/cdLoadAssets() — Terminal
// shows every non-zero coin; Coin-Detail (via `filterToSymbols`) narrows the
// table to just the current pair's base asset + USDT and adds sell buttons.
export default function AssetsList({ creds, clockOffset, filterToSymbols = null, onSell, onCountChange }) {
  const [state, setState] = useState({ loading: true, error: null, coins: [] });

  const load = useCallback(async () => {
    if (!creds?.apiKey) {
      setState({ loading: false, error: null, coins: [] });
      onCountChange?.(0);
      return;
    }
    try {
      let r = await bybitRequest(creds, 'GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' }, null, clockOffset);
      if (r.retCode !== 0 || !(r.result?.list?.[0]?.coin?.length)) {
        r = await bybitRequest(creds, 'GET', '/v5/account/wallet-balance', { accountType: 'SPOT' }, null, clockOffset);
      }
      if (r.retCode !== 0) { setState({ loading: false, error: r.retMsg, coins: [] }); return; }
      let coins = (r.result?.list?.[0]?.coin || []).filter((c) => parseFloat(c.walletBalance) > 0 && parseFloat(c.usdValue) > 0);
      if (filterToSymbols) coins = coins.filter((c) => filterToSymbols.includes(c.coin));
      setState({ loading: false, error: null, coins });
      onCountChange?.(coins.length);
    } catch (e) {
      setState({ loading: false, error: e.message, coins: [] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creds?.apiKey, creds?.apiSecret, creds?.env, clockOffset, filterToSymbols?.join(',')]);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  if (!creds?.apiKey) return <div className="trd-empty">No API credentials — add them in Settings → Bybit.</div>;
  if (state.loading) return <div className="trd-empty">Loading…</div>;
  if (state.error) return <div className="trd-empty trd-error">✗ {state.error}</div>;
  if (!state.coins.length) return <div className="trd-empty">No assets found</div>;

  const totalUSD = state.coins.reduce((s, c) => s + parseFloat(c.usdValue || 0), 0);

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="trd-assets-table">
        <thead>
          <tr>
            <th>Asset</th>
            <th style={{ textAlign: 'right' }}>Wallet Balance</th>
            <th style={{ textAlign: 'right' }}>Available</th>
            <th style={{ textAlign: 'right' }}>USD Value</th>
            {onSell && <th />}
          </tr>
        </thead>
        <tbody>
          {state.coins.map((c) => {
            const total = parseFloat(c.walletBalance || 0);
            const avail = parseFloat(c.availableToWithdraw || c.availableToBorrow || c.free || 0);
            const usd = parseFloat(c.usdValue || 0);
            return (
              <tr key={c.coin}>
                <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{c.coin}</td>
                <td style={{ textAlign: 'right' }}>{total.toFixed(6)}</td>
                <td style={{ textAlign: 'right', color: 'var(--accent-green)' }}>{avail.toFixed(6)}</td>
                <td style={{ textAlign: 'right', color: 'var(--accent-blue)' }}>${usd.toFixed(2)}</td>
                {onSell && c.coin !== 'USDT' && (
                  <td>
                    <div className="trd-sell-btns">
                      <button type="button" onClick={() => onSell(c.coin + 'USDT', 0.5)}>50%</button>
                      <button type="button" onClick={() => onSell(c.coin + 'USDT', 1.0)}>All</button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
          {!filterToSymbols && (
            <tr style={{ fontWeight: 700, borderTop: '1px solid var(--border-dim)' }}>
              <td colSpan={3} style={{ color: 'var(--text-muted)' }}>Total</td>
              <td style={{ textAlign: 'right', color: 'var(--accent-green)' }}>${totalUSD.toFixed(2)}</td>
              {onSell && <td />}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
