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
