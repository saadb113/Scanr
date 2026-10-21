import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import PremiumGate from '../components/PremiumGate';
import './PnlCalendar.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt2 = (n) => (n >= 0 ? '+$' : '-$') + Math.abs(n).toFixed(2);

function buildWeeks(year) {
  const jan1 = new Date(year, 0, 1);
  const startDow = jan1.getDay();
  const weeks = [];
  let week = [];
  for (let i = 0; i < startDow; i++) week.push(null);

  const dec31 = new Date(year, 11, 31);
  const numDays = Math.round((dec31 - jan1) / 86400000) + 1;
  for (let i = 0; i < numDays; i++) {
    const d = new Date(year, 0, 1 + i);
    week.push(d.toISOString().split('T')[0]);
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return weeks;
}

function dayClass(dateStr, data, todayStr) {
  const classes = ['cal-day'];
  if (!dateStr) return 'cal-day empty';
  if (dateStr === todayStr) classes.push('today');
  if (data && data.trades > 0) {
    if (data.pnl > 0) {
      classes.push('profit');
      if (data.pnl < 50) classes.push('low');
    } else if (data.pnl < 0) {
      classes.push('loss');
      if (data.pnl > -50) classes.push('low');
    }
  }
  return classes.join(' ');
}

export default function PnlCalendar() {
  return (
    <PremiumGate>
      <PnlCalendarContent />
    </PremiumGate>
  );
}

function PnlCalendarContent() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [calData, setCalData] = useState({});
  const [tooltip, setTooltip] = useState(null); // { x, y, dateStr, data }

  useEffect(() => {
    api.get('/api/pnl-calendar').then((d) => setCalData(d.data || {})).catch((e) => console.error('Calendar load failed', e));
  }, []);

  const todayStr = new Date().toISOString().split('T')[0];
  const weeks = useMemo(() => buildWeeks(year), [year]);

  const stats = useMemo(() => {
    let totalPnl = 0, greenDays = 0, redDays = 0, bestDay = 0;
    Object.entries(calData).forEach(([date, d]) => {
      if (!date.startsWith(String(year))) return;
      totalPnl += d.pnl || 0;
      if (d.pnl > 0) { greenDays++; if (d.pnl > bestDay) bestDay = d.pnl; }
      if (d.pnl < 0) redDays++;
    });
    return { totalPnl, greenDays, redDays, bestDay };
  }, [calData, year]);

  const monthLabels = useMemo(() => {
    const labels = [];
    let currentMonth = -1;
    weeks.forEach((w) => {
      const firstReal = w.find((d) => d !== null);
      if (!firstReal) { labels.push(''); return; }
      const m = parseInt(firstReal.split('-')[1], 10) - 1;
      if (m !== currentMonth) {
        currentMonth = m;
        labels.push(MONTHS[m]);
      } else {
        labels.push('');
      }
    });
    return labels;
  }, [weeks]);

  function showTooltip(e, dateStr, data) {
    setTooltip({ x: e.clientX + 12, y: e.clientY - 10, dateStr, data });
  }
  function moveTooltip(e) {
    setTooltip((t) => (t ? { ...t, x: e.clientX + 12, y: e.clientY - 10 } : t));
  }

  return (
    <div className="page-content">
      <div className="cal-wrap">
        <div className="cal-header">
          <div className="cal-title">📅 PnL Calendar</div>
          <div className="cal-year-nav">
            <button className="cal-year-btn" onClick={() => setYear((y) => y - 1)}>← Prev</button>
            <span className="cal-year-label">{year}</span>
            <button className="cal-year-btn" onClick={() => setYear((y) => y + 1)}>Next →</button>
          </div>
        </div>

        <div className="cal-stats">
          <div className="cal-stat"><div className="cal-stat-label">Total PnL</div><div className="cal-stat-val" style={{ color: stats.totalPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt2(stats.totalPnl)}</div></div>
          <div className="cal-stat"><div className="cal-stat-label">Green Days</div><div className="cal-stat-val val-green">{stats.greenDays}</div></div>
          <div className="cal-stat"><div className="cal-stat-label">Red Days</div><div className="cal-stat-val val-red">{stats.redDays}</div></div>
          <div className="cal-stat"><div className="cal-stat-label">Best Day</div><div className="cal-stat-val val-green">{stats.bestDay > 0 ? `+$${stats.bestDay.toFixed(2)}` : '—'}</div></div>
        </div>

        <div className="cal-legend">
          <span className="cal-leg-item"><span className="cal-leg-sq" style={{ background: 'var(--green)' }} /> Profitable day</span>
          <span className="cal-leg-item"><span className="cal-leg-sq" style={{ background: 'var(--red)' }} /> Losing day</span>
          <span className="cal-leg-item"><span className="cal-leg-sq" style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }} /> No trades</span>
          <span className="cal-leg-item"><span className="cal-leg-sq" style={{ background: 'var(--bg-raised)', border: '1px solid var(--text-secondary)' }} /> Today</span>
        </div>

        <div className="cal-grid-wrap">
          <div className="cal-month-labels">
            {monthLabels.map((label, i) => <div className="cal-month-label" key={i}>{label}</div>)}
          </div>
          <div className="cal-grid">
            <div className="cal-dow-col">
              <div className="cal-dow-label" />
              <div className="cal-dow-label">Mon</div>
              <div className="cal-dow-label" />
              <div className="cal-dow-label">Wed</div>
              <div className="cal-dow-label" />
              <div className="cal-dow-label">Fri</div>
              <div className="cal-dow-label" />
            </div>
            <div className="cal-weeks">
              {weeks.map((w, wi) => (
                <div className="cal-week" key={wi}>
                  {w.map((dateStr, di) => {
                    const data = dateStr ? calData[dateStr] : null;
                    const hasTooltip = dateStr && data && data.trades > 0;
                    return (
                      <div
                        key={di}
                        className={dayClass(dateStr, data, todayStr)}
                        onMouseEnter={hasTooltip ? (e) => showTooltip(e, dateStr, data) : undefined}
                        onMouseMove={hasTooltip ? moveTooltip : undefined}
                        onMouseLeave={hasTooltip ? () => setTooltip(null) : undefined}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {tooltip && (
        <div className="cal-tooltip visible" style={{ left: tooltip.x, top: tooltip.y }}>
          <div className="cal-tt-date">
            {(() => { const [y, m, d] = tooltip.dateStr.split('-'); return `${MONTHS[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}`; })()}
          </div>
          <div className="cal-tt-row"><span>Trades</span><span>{tooltip.data.trades}</span></div>
          <div className="cal-tt-row"><span>PnL</span><span style={{ color: (tooltip.data.pnl || 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt2(tooltip.data.pnl || 0)}</span></div>
          <div className="cal-tt-row"><span>W/L</span><span>{tooltip.data.wins || 0} / {tooltip.data.losses || 0}</span></div>
        </div>
      )}
    </div>
  );
}
