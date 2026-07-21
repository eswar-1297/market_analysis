export default function Assessment({ data }) {
  const a = data.assessment;
  return (
    <div className={`assess verdict-card tone-${a.tone}`}>
      <div className="verdict">
        <span className={`badge ${a.tone}`}>{a.verdict}</span>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>
          Team health for this combination over the selected period
        </span>
      </div>

      <div className="signals">
        {a.signals.map((s) => (
          <div className="signal" key={s.key}>
            <div className="k">{s.label}</div>
            <div className="v">
              {s.reliable === false ? (
                <span style={{ color: 'var(--muted)', fontWeight: 500, fontSize: 13 }}>too little data</span>
              ) : (
                <span className={`delta ${s.direction}`}>
                  {s.direction === 'up' ? '▲' : s.direction === 'down' ? '▼' : '—'}{' '}
                  {s.deltaPct > 0 ? '+' : ''}
                  {s.deltaPct}%
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <ul className="flags">
        {a.flags.map((f, i) => (
          <li key={i}>{f}</li>
        ))}
      </ul>
    </div>
  );
}
