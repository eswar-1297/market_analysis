import TrendChart from './TrendChart.jsx';

const fmt = (n) =>
  n >= 1000000 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n));
const money = (n) => '$' + fmt(n);

export default function PpcPanel({ data }) {
  const t = data.totals;
  const cards = [
    { label: 'Ad spend', value: money(t.spend) },
    { label: 'Ad clicks', value: fmt(t.clicks) },
    { label: 'Impressions', value: fmt(t.impressions) },
    { label: 'Avg. CPC', value: '$' + t.cpc },
    { label: 'Paid sessions', value: fmt(t.paidSessions) },
    { label: 'Paid conversions', value: fmt(t.paidConversions) },
  ];

  return (
    <>
      <div className="warn-banner" style={{ background: 'var(--brand-wash)', borderColor: 'var(--brand-tint)', color: 'var(--ink-soft)' }}>
        Ad <strong>spend / clicks / impressions</strong> are campaign-level (all regions — Google Ads doesn't
        attribute cost per page). <strong>Paid sessions &amp; conversions</strong> reflect the region you selected.
      </div>

      <div className="grid cards">
        {cards.map((c) => (
          <div className="card" key={c.label}>
            <div className="label">{c.label}</div>
            <div className="value">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="grid charts">
        <TrendChart title="Ad spend ($)" hint="Google Ads via GA4" data={data.trends.spend} color="#e07b39" />
        <TrendChart title="Ad clicks" hint="Google Ads" data={data.trends.clicks} color="#d64550" />
        <TrendChart title="Paid sessions" hint="Paid Search" data={data.trends.sessions} color="#0129ac" />
        <TrendChart title="Paid conversions" hint="Paid Search" data={data.trends.conversions} color="#0e9f6e" />
      </div>

      <div className="section-title">Campaigns by spend</div>
      <div className="table-card" style={{ marginBottom: 22 }}>
        <table>
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Spend</th>
              <th>Clicks</th>
              <th>Impressions</th>
              <th>CPC</th>
            </tr>
          </thead>
          <tbody>
            {data.campaigns.map((c) => (
              <tr key={c.campaign}>
                <td>{c.campaign}</td>
                <td>{money(c.cost)}</td>
                <td>{fmt(c.clicks)}</td>
                <td>{fmt(c.impressions)}</td>
                <td>${c.clicks ? (c.cost / c.clicks).toFixed(2) : '0'}</td>
              </tr>
            ))}
            {!data.campaigns.length && (
              <tr>
                <td colSpan={5} style={{ color: 'var(--muted)' }}>No campaign spend in this period.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="section-title">Paid-search leads by landing page</div>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Landing page</th>
              <th>Paid sessions</th>
              <th>Leads</th>
              <th>Lead rate</th>
            </tr>
          </thead>
          <tbody>
            {[...data.landingPages]
              .sort((a, b) => b.conversions - a.conversions || b.sessions - a.sessions)
              .map((p) => (
                <tr key={p.page}>
                  <td>{p.page}</td>
                  <td>{fmt(p.sessions)}</td>
                  <td>{fmt(p.conversions)}</td>
                  <td>{p.sessions ? ((p.conversions / p.sessions) * 100).toFixed(1) + '%' : '—'}</td>
                </tr>
              ))}
            {!data.landingPages.length && (
              <tr>
                <td colSpan={4} style={{ color: 'var(--muted)' }}>No paid-search traffic in this period.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
