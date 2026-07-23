const fmt = (n) => (n == null ? '—' : n >= 1000 ? (n / 1e3).toFixed(1) + 'k' : String(n));

// All combinations at a glance. Click a row to drill into that combination.
export default function Overview({ rows, onOpen }) {
  return (
    <div>
      <div className="section-title">All combinations ({rows.length})</div>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Combination</th>
              <th>Avg. position</th>
              <th>Impressions</th>
              <th>Organic clicks</th>
              <th>Views</th>
              <th>Bounce rate</th>
              <th>Conversions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="clickable-row" onClick={() => onOpen(r.id)}>
                <td>
                  <span className="combo-link">{r.name}</span>{' '}
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>({r.pageCount})</span>
                </td>
                <td>{r.position || '—'}</td>
                <td>{fmt(r.impressions)}</td>
                <td>{fmt(r.clicks)}</td>
                <td>{fmt(r.views)}</td>
                <td>{r.bounceRate ? Math.round(r.bounceRate * 100) + '%' : '—'}</td>
                <td>{fmt(r.conversions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
