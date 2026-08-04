import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const MENU_WIDTH = 172;

// A range filter that lives inside a column header, next to the field name —
// so filtering costs no extra table row. `value` is the selected option index
// (null = unfiltered); `onChange` receives an index or null.
export default function ColumnFilter({ label, options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  // The menu is fixed-position so the table card's scroll container can't clip
  // it; anchor it under the button and keep it inside the viewport.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({
      top: r.bottom + 6,
      left: Math.max(8, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)),
    });
  }, [open]);

  // Dismiss on outside click, Escape, or anything that moves the anchor.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!menuRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  // Nothing to filter on (e.g. a column with no data yet) — plain label.
  if (!options?.length) return label;

  const active = value != null;
  const pick = (idx) => {
    onChange(idx);
    setOpen(false);
  };

  return (
    <span className="th-filter">
      <span>{label}</span>
      <button
        ref={btnRef}
        type="button"
        className={`filter-btn${active ? ' on' : ''}`}
        aria-label={`Filter by ${label}`}
        aria-expanded={open}
        title={active ? `${label}: ${options[value].label}` : `Filter by ${label}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
          <path d="M1 2h10L7 6.6V11L5 9.6V6.6z" fill="currentColor" />
        </svg>
      </button>
      {open && pos && (
        <div ref={menuRef} className="filter-menu" style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}>
          <button type="button" className={`filter-opt${active ? '' : ' sel'}`} onClick={() => pick(null)}>
            All
          </button>
          {options.map((rg, i) => (
            <button key={i} type="button" className={`filter-opt${value === i ? ' sel' : ''}`} onClick={() => pick(i)}>
              {rg.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
