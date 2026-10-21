import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import Pagination from '../../components/Pagination';

const PER_PAGE = 10;

export default function AdminRevenue() {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    api.get('/api/admin/revenue').then(setData).catch((e) => console.error(e));
  }, []);

  if (!data) return <div className="adm-empty-row">Loading...</div>;

  const months = Object.keys(data.monthly).sort().reverse();
  const slice = months.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 20 }}>Revenue Overview</div>
      <div className="adm-stats-grid">
        <div className="adm-stat-card"><div className="adm-stat-label">Total Licenses</div><div className="adm-stat-value">{data.total}</div></div>
        <div className="adm-stat-card"><div className="adm-stat-label">Total Revenue</div><div className="adm-stat-value yellow">${data.revenue.toFixed(2)}</div></div>
        <div className="adm-stat-card"><div className="adm-stat-label">Active</div><div className="adm-stat-value green">{data.active}</div></div>
        <div className="adm-stat-card"><div className="adm-stat-label">Inactive</div><div className="adm-stat-value" style={{ color: 'var(--muted)' }}>{data.inactive}</div></div>
        <div className="adm-stat-card"><div className="adm-stat-label">Suspended</div><div className="adm-stat-value red">{data.suspended}</div></div>
      </div>
      <div className="adm-card">
        <div className="adm-card-title">Monthly Breakdown</div>
        <div className="adm-tbl-wrap">
          <table className="adm-month-table">
            <thead><tr><th>Month</th><th>Licenses Sold</th><th>Revenue</th></tr></thead>
            <tbody>
              {!months.length ? (
                <tr><td colSpan={3} style={{ color: 'var(--muted)', padding: 20, textAlign: 'center' }}>No data yet</td></tr>
              ) : slice.map((m) => (
                <tr key={m}><td>{m}</td><td>{data.monthly[m].count}</td><td>${data.monthly[m].revenue.toFixed(2)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        {months.length > 0 && <Pagination page={page} perPage={PER_PAGE} total={months.length} onChange={setPage} />}
      </div>
    </div>
  );
}
