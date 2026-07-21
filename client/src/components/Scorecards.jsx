const fmt = (n) =>
  n >= 1000000 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1e3).toFixed(1) + 'k' : String(n);

function Delta({ d }) {
  if (!d) return null;
  if (d.reliable === false) {
    return (
      <div className="delta flat">
        — <span style={{ color: 'var(--muted)', fontWeight: 400 }}>too little data</span>
      </div>
    );
  }
  const arrow = d.direction === 'up' ? '▲' : d.direction === 'down' ? '▼' : '—';
  const sign = d.deltaPct > 0 ? '+' : '';
  return (
    <div className={`delta ${d.direction}`}>
      {arrow} {sign}
      {d.deltaPct}% <span style={{ color: 'var(--muted)', fontWeight: 400 }}>vs prev</span>
    </div>
  );
}

export default function Scorecards({ data }) {
  const { totals, deltas, cwv } = data;
  const cards = [
    { label: 'Page views', value: fmt(totals.pageViews ?? 0), d: null, sub: 'all visits to these pages' },
    { label: 'Sessions', value: fmt(totals.sessions), d: deltas.sessions, sub: 'entries via these pages' },
    { label: 'Conversions', value: fmt(totals.conversions), d: deltas.conversions },
    { label: 'Organic clicks', value: fmt(totals.clicks), d: deltas.clicks },
    { label: 'Impressions', value: fmt(totals.impressions), d: null },
    { label: 'Avg. position', value: totals.avgPosition || '—', d: deltas.position },
    {
      label: 'Core Web Vitals',
      value: cwv ? <span className={`pill ${cwv.overall}`}>{cwv.overall}</span> : '—',
      d: null,
      sub: cwv ? `${(cwv.lcp.value / 1000).toFixed(1)}s LCP · perf ${cwv.performanceScore}` : '',
    },
  ];
  return (
    <div className="grid cards">
      {cards.map((c) => (
        <div className="card" key={c.label}>
          <div className="label">{c.label}</div>
          <div className="value">{c.value}</div>
          {c.d && <Delta d={c.d} />}
          {c.sub && <div style={{ color: 'var(--muted)', fontSize: 11.5, marginTop: 6 }}>{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}
