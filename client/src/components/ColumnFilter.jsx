import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const MENU_WIDTH = 172;

// A column header control: click the field name to sort by it, or the funnel to
// filter it to a range — both without costing an extra table row.
//   value / onChange — selected range-option index (null = unfiltered).
//   sort / onSort    — 'asc' | 'desc' | null for THIS column; onSort cycles it.
//   action           — optional extra control for the far right of the header
//                      (the Perf. column's refresh button).
// The sort caret sits to the left of the label and mirrors the funnel button's
// width, so the label stays centred over its column of values.
export default function ColumnFilter({ label, options, value, onChange, sort = null, onSort, action = null }) {
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

  const canFilter = !!options?.length;

  // Nothing to sort, filter, or act on — plain label.
  if (!canFilter && !onSort && !action) return label;

  const active = canFilter && value != null;
  const pick = (idx) => {
    onChange(idx);
    setOpen(false);
  };

  // Next state in the cycle, so the tooltip says what a click will do.
  const nextHint = sort === 'asc' ? 'highest first' : sort === 'desc' ? 'original order' : 'lowest first';

  // The caret balances the funnel button on the other side of the label, so it
  // leads in filterable (centred) columns. Without a funnel there is nothing to
  // balance, so it trails instead of indenting a left-aligned header.
  const caret = (
    <span className={`sort-ind${sort ? ' on' : ''}`} aria-hidden="true">
      {sort === 'asc' ? '▲' : sort === 'desc' ? '▼' : ''}
    </span>
  );

  return (
    <span className={`th-filter${canFilter ? '' : ' no-filter'}${active ? ' filtered' : ''}`}>
      {canFilter && caret}
      {onSort ? (
        <button
          type="button"
          className={`th-sort${sort ? ' on' : ''}`}
          title={
            active
              ? `${label}: ${options[value].label} — click to sort, ${nextHint}`
              : `Sort by ${label} — ${nextHint}`
          }
          aria-label={`Sort by ${label} — ${nextHint}`}
          onClick={(e) => {
            e.stopPropagation();
            onSort();
          }}
        >
          {label}
        </button>
      ) : (
        <span>{label}</span>
      )}
      {!canFilter && caret}
      {canFilter && (
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
      )}
      {action}
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
