import { useState } from 'react';

export default function PasswordField({ value, onChange, placeholder }) {
  const [visible, setVisible] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={visible ? 'text' : 'password'}
        className="s-input-full"
        placeholder={placeholder}
        style={{ paddingRight: '3rem' }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        style={{ position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#6b7897', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}
