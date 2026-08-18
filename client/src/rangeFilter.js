// Shared per-column range-filter helpers, used by both the overview table and
// the combination/author page tables so they behave identically.

// Whole-number formatter for range labels (no decimals): 8275 -> "8k".
export const fmtRound = (n) => {
  const v = Math.round(n);
  return v >= 1000 ? Math.round(v / 1000) + 'k' : String(v);
};

// Split a column's values into up to 4 ascending ranges (min→max). Bounds shown
// as whole numbers; the top range is open-ended ("8+") so it keeps working as
// the numbers grow.
export function makeRanges(values, format) {
  const nums = values.filter((v) => typeof v === 'number' && !Number.isNaN(v));
  if (nums.length < 2) return [];
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (min === max) return [];
  const n = Math.min(4, new Set(nums).size);
  const step = (max - min) / n;
  const out = [];
  for (let i = 0; i < n; i++) {
    const lo = min + step * i;
    if (i === n - 1) {
      out.push({ lo, hi: Infinity, label: `${format(lo)}+` });
    } else {
      const hi = min + step * (i + 1);
      out.push({ lo, hi, label: `${format(lo)} – ${format(hi)}` });
    }
  }
  return out;
}

// Whether a value passes a selected range (half-open [lo, hi); top is open).
export function inRange(v, rng) {
  if (!rng) return true;
  if (typeof v !== 'number' || Number.isNaN(v)) return true; // keep rows with no value
  return v >= rng.lo && (rng.hi === Infinity ? true : v < rng.hi);
}

// ---------- Sorting ----------

// Clicking a column header cycles its sort: unsorted -> ascending (lowest
// first) -> descending -> back to the data's natural order.
export function nextSort(cur, key) {
  if (cur?.key !== key) return { key, dir: 'asc' };
  if (cur.dir === 'asc') return { key, dir: 'desc' };
  return null;
}

// Sort rows by a column's accessor. Rows with no value for that column sink to
// the bottom in BOTH directions — a page whose score hasn't loaded yet must not
// masquerade as the smallest number.
export function sortRows(rows, sort, cols) {
  const col = sort && cols.find((c) => c.key === sort.key);
  if (!col) return rows;
  const missing = (v) => v == null || v === '' || (typeof v === 'number' && Number.isNaN(v));
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = col.get(a);
    const y = col.get(b);
    if (missing(x) || missing(y)) return missing(x) && missing(y) ? 0 : missing(x) ? 1 : -1;
    if (typeof x === 'string' || typeof y === 'string') {
      return sign * String(x).localeCompare(String(y), undefined, { numeric: true });
    }
    return sign * (x - y);
  });
}
