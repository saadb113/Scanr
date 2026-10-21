import { useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { FILTER_TOGGLES } from '../constants';

export default function FiltersTab() {
  const [state, setState] = useState({});

  useEffect(() => {
    api.get('/api/filter-vis').then((d) => setState(d || {})).catch(() => {});
  }, []);

  async function toggle(id, checked) {
    const next = { ...state, [id]: checked };
    setState(next);
    await api.post('/api/filter-vis', next);
  }

  return (
    <div className="sp-grid">
      <div className="sp-card">
        <div className="sp-card-title">Visible Filter Buttons</div>
        <div>
          {FILTER_TOGGLES.map((f) => (
            <div className="filter-toggle-row" key={f.id}>
              <span className="filter-toggle-label"><span className="fdot" style={{ background: f.color }} />{f.label}</span>
              <label className="toggle-switch">
                <input type="checkbox" checked={state[f.id] !== false} onChange={(e) => toggle(f.id, e.target.checked)} />
                <span className="slider" />
              </label>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
