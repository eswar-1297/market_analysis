import { useState } from 'react';

export default function Sidebar({ combinations, selectedId, onSelect, meta }) {
  const [q, setQ] = useState('');
  const filtered = combinations.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          Cloud<span>Fuze</span> Marketing
        </div>
        <div className="sub">
          {meta ? `${meta.combinationCount} combinations · ${meta.pageCount} pages` : ' '}
        </div>
        <input
          className="search"
          placeholder="Search combinations…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="combo-list">
        <div
          className={`combo-item ppc-item ${selectedId === '__ppc__' ? 'active' : ''}`}
          onClick={() => onSelect('__ppc__')}
        >
          <span className="dot" style={{ background: '#e07b39' }} />
          <div>
            <div className="name">Paid Search (PPC)</div>
            <div className="meta">All campaigns · Google Ads</div>
          </div>
        </div>
        <div className="combo-divider">Combinations</div>
        {filtered.map((c) => (
          <div
            key={c.id}
            className={`combo-item ${c.id === selectedId ? 'active' : ''}`}
            onClick={() => onSelect(c.id)}
          >
            <span className={`dot ${c.tone || 'neutral'}`} />
            <div>
              <div className="name">{c.name}</div>
              <div className="meta">{c.pageCount} page{c.pageCount !== 1 ? 's' : ''}</div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
