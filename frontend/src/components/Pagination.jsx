import './Pagination.css';

// React port of public/js/pagination.js — same page-number/ellipsis behavior.
export default function Pagination({ page, perPage, total, onChange }) {
  if (!total) return null;
  const pages = Math.ceil(total / perPage) || 1;
  const clamped = Math.max(1, Math.min(page, pages));

  if (pages <= 1) {
    return (
      <div className="pg-bar">
        <span className="pg-info">{total} row{total !== 1 ? 's' : ''}</span>
      </div>
    );
  }

  const from = (clamped - 1) * perPage + 1;
  const to = Math.min(clamped * perPage, total);

  function numbers() {
    const nums = [];
    const btn = (p, label, disabled) => (
      <button
        key={label + p}
        className={`pg-btn${p === clamped && !disabled ? ' pg-active' : ''}`}
        disabled={disabled}
        onClick={() => onChange(p)}
      >
        {label}
      </button>
    );
    if (pages <= 7) {
      for (let p = 1; p <= pages; p++) nums.push(btn(p, p, p === clamped));
    } else {
      nums.push(btn(1, 1, clamped === 1));
      if (clamped > 3) nums.push(<span className="pg-dots" key="dots-start">&hellip;</span>);
      const s2 = Math.max(2, clamped - 1);
      const e2 = Math.min(pages - 1, clamped + 1);
      for (let p = s2; p <= e2; p++) nums.push(btn(p, p, p === clamped));
      if (clamped < pages - 2) nums.push(<span className="pg-dots" key="dots-end">&hellip;</span>);
      nums.push(btn(pages, pages, clamped === pages));
    }
    return nums;
  }

  return (
    <div className="pg-bar">
      <span className="pg-info">{from}&ndash;{to} of {total}</span>
      <div className="pg-btns">
        <button className="pg-btn" disabled={clamped <= 1} onClick={() => onChange(clamped - 1)}>&#8249;</button>
        {numbers()}
        <button className="pg-btn" disabled={clamped >= pages} onClick={() => onChange(clamped + 1)}>&#8250;</button>
      </div>
    </div>
  );
}
