import { useEffect, useState } from 'react';
import { bybitRequest } from '../../utils/bybit';

// Ported from bytOpenModify()/bytSubmitModify() (and coin-detail's
// cdOpenModify/cdSubmitModify, which is functionally identical).
export default function ModifyPositionModal({ open, position, category, creds, clockOffset, onClose, onSaved }) {
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (open && position) {
      setSl(parseFloat(position.stopLoss) > 0 ? parseFloat(position.stopLoss) : '');
      setTp(parseFloat(position.takeProfit) > 0 ? parseFloat(position.takeProfit) : '');
      setMsg(null);
    }
  }, [open, position]);

  if (!open || !position) return null;

  async function submit() {
    if (!sl && !tp) { setMsg({ text: 'Enter SL or TP to update', color: 'var(--accent-amber)' }); return; }
    try {
      const body = { category, symbol: position.symbol, positionIdx: 0 };
      if (sl) { body.stopLoss = String(sl); body.slTriggerBy = 'MarkPrice'; }
      if (tp) { body.takeProfit = String(tp); body.tpTriggerBy = 'MarkPrice'; }
      const res = await bybitRequest(creds, 'POST', '/v5/position/trading-stop', null, body, clockOffset);
      if (res.retCode === 0) {
        setMsg({ text: '✓ Updated!', color: 'var(--accent-green)' });
        setTimeout(() => { onSaved?.(); onClose(); }, 900);
      } else {
        setMsg({ text: `✗ ${res.retMsg}`, color: 'var(--accent-red)' });
      }
    } catch (e) {
      setMsg({ text: `✗ ${e.message}`, color: 'var(--accent-red)' });
    }
  }

  return (
    <div className="trd-modal-overlay" onClick={onClose}>
      <div className="trd-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="trd-modal-head">
          <div className="trd-modal-title">Modify {position.symbol} {position.side === 'Buy' ? 'LONG' : 'SHORT'}</div>
          <button type="button" className="trd-modal-x" onClick={onClose}>&times;</button>
        </div>
        <div className="trd-field">
          <label>Stop Loss</label>
          <input className="trd-input" type="number" step="any" placeholder="Leave blank to keep current" value={sl} onChange={(e) => setSl(e.target.value)} />
        </div>
        <div className="trd-field">
          <label>Take Profit</label>
          <input className="trd-input" type="number" step="any" placeholder="Leave blank to keep current" value={tp} onChange={(e) => setTp(e.target.value)} />
        </div>
        <button type="button" className="trd-modal-save" onClick={submit}>Update Position</button>
        {msg && <div className="trd-modal-msg" style={{ color: msg.color }}>{msg.text}</div>}
      </div>
    </div>
  );
}
