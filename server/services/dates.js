// Date helpers shared by connectors and aggregation.

export function toISO(d) {
  return d.toISOString().slice(0, 10);
}

// Inclusive list of YYYY-MM-DD strings between start and end.
export function dateRange(start, end) {
  const out = [];
  const cur = new Date(start + 'T00:00:00Z');
  const last = new Date(end + 'T00:00:00Z');
  while (cur <= last) {
    out.push(toISO(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export function daysBetween(start, end) {
  return dateRange(start, end).length;
}

// The equal-length period immediately BEFORE [start, end], used for deltas.
export function previousPeriod(start, end) {
  const n = daysBetween(start, end);
  const prevEnd = new Date(start + 'T00:00:00Z');
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevStart.getUTCDate() - (n - 1));
  return { start: toISO(prevStart), end: toISO(prevEnd) };
}
