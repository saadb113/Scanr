import { useEffect, useState } from 'react';
import { bybitRequest } from '../../utils/bybit';

// Ported from bytOpenModifyOrder()/bytSubmitModifyOrder(). Terminal-only —
// Coin-Detail's Orders tab never offered order editing (see OrdersList).
export default function ModifyOrderModal({ open, order, category, creds, clockOffset, onClose, onSaved }) {
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('');
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (open && order) {
      setPrice(parseFloat(order.price) > 0 ? order.price : '');
      setQty(order.qty || '');
      setSl(parseFloat(order.stopLoss) > 0 ? order.stopLoss : '');
      setTp(parseFloat(order.takeProfit) > 0 ? order.takeProfit : '');
      setMsg(null);
    }
  }, [open, order]);

  if (!open || !order) return null;

  async function submit() {
    try {
      const body = { category, symbol: order.symbol, orderId: order.orderId };
      if (price) body.price = String(price);
      if (qty) body.qty = String(qty);
      if (sl) body.stopLoss = String(sl);
      if (tp) body.takeProfit = String(tp);
      const res = await bybitRequest(creds, 'POST', '/v5/order/amend', null, body, clockOffset);
      if (res.retCode === 0) {
        setMsg({ text: '✓ Order updated!', color: 'var(--accent-green)' });
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
          <div className="trd-modal-title">Modify Order</div>
          <button type="button" className="trd-modal-x" onClick={onClose}>&times;</button>
        </div>
        <div className="trd-field"><label>New Price</label><input className="trd-input" type="number" step="any" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
        <div className="trd-field"><label>New Qty</label><input className="trd-input" type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        <div className="trd-field"><label>New SL</label><input className="trd-input" type="number" step="any" placeholder="Optional" value={sl} onChange={(e) => setSl(e.target.value)} /></div>
        <div className="trd-field"><label>New TP</label><input className="trd-input" type="number" step="any" placeholder="Optional" value={tp} onChange={(e) => setTp(e.target.value)} /></div>
        <button type="button" className="trd-modal-save" onClick={submit}>Update Order</button>
        {msg && <div className="trd-modal-msg" style={{ color: msg.color }}>{msg.text}</div>}
      </div>
    </div>
  );
}
