// Rolls per-page data up to the combination level, builds trend series,
// computes period-over-period deltas, and produces the assessment layer.

function sumBy(pages, source, field) {
  // Additive daily series summed across pages (pages share the same dates).
  if (!pages.length) return [];
  const len = pages[0][source].length;
  const out = [];
  for (let i = 0; i < len; i++) {
    let value = 0;
    let date = null;
    for (const p of pages) {
      const row = p[source][i];
      if (!row) continue;
      date = row.date;
      value += Number(row[field] || 0);
    }
    out.push({ date, value: Number(value.toFixed(2)) });
  }
  return out;
}

function weightedPosition(pages) {
  // Avg organic position weighted by impressions (lower is better).
  if (!pages.length) return [];
  const len = pages[0].searchConsole.length;
  const out = [];
  for (let i = 0; i < len; i++) {
    let wsum = 0;
    let isum = 0;
    let date = null;
    for (const p of pages) {
      const row = p.searchConsole[i];
      if (!row) continue;
      date = row.date;
      wsum += (row.position || 0) * (row.impressions || 0);
      isum += row.impressions || 0;
    }
    out.push({ date, value: isum ? Number((wsum / isum).toFixed(1)) : 0 });
  }
  return out;
}

const total = (series) => series.reduce((a, b) => a + b.value, 0);

// `minVolume` guards against noisy percentages on tiny numbers: if the combined
// current+previous volume is below the floor, the change isn't statistically
// meaningful, so we mark it unreliable and treat direction as flat.
function delta(current, previous, { lowerIsBetter = false, volume = null, minVolume = 0 } = {}) {
  const cur = total(current);
  const prev = total(previous);
  const raw = prev === 0 ? (cur === 0 ? 0 : 100) : ((cur - prev) / prev) * 100;
  const pct = Number(raw.toFixed(1));
  const effective = lowerIsBetter ? -pct : pct;
  const vol = volume === null ? cur + prev : volume;
  const reliable = vol >= minVolume;
  let direction = 'flat';
  if (reliable) {
    if (effective > 5) direction = 'up';
    else if (effective < -5) direction = 'down';
  }
  return { current: Number(cur.toFixed(1)), previous: Number(prev.toFixed(1)), deltaPct: pct, direction, reliable };
}

// --- Core Web Vitals thresholds (Google's official buckets) ---
function cwvStatus(metric, value) {
  const t = {
    lcp: [2500, 4000],
    inp: [200, 500],
    cls: [0.1, 0.25],
  }[metric];
  if (value <= t[0]) return 'good';
  if (value <= t[1]) return 'needs-improvement';
  return 'poor';
}

function rollupCWV(pages) {
  const vals = pages.map((p) => p.pagespeed).filter(Boolean);
  if (!vals.length) return null;
  const avg = (f) => vals.reduce((a, b) => a + (b[f] || 0), 0) / vals.length;
  const lcp = Math.round(avg('lcp'));
  const inp = Math.round(avg('inp'));
  const cls = Number(avg('cls').toFixed(3));
  const perf = Math.round(avg('performanceScore'));
  const statuses = [cwvStatus('lcp', lcp), cwvStatus('inp', inp), cwvStatus('cls', cls)];
  const worst = statuses.includes('poor') ? 'poor' : statuses.includes('needs-improvement') ? 'needs-improvement' : 'good';
  return {
    lcp: { value: lcp, status: cwvStatus('lcp', lcp) },
    inp: { value: inp, status: cwvStatus('inp', inp) },
    cls: { value: cls, status: cwvStatus('cls', cls) },
    performanceScore: perf,
    overall: worst,
    source: vals[0].source,
  };
}

function pageWeightedPosition(p) {
  let wsum = 0;
  let isum = 0;
  for (const r of p.searchConsole) {
    wsum += (r.position || 0) * (r.impressions || 0);
    isum += r.impressions || 0;
  }
  return isum ? Number((wsum / isum).toFixed(1)) : 0;
}

const pageMetric = (p, src, f) => Math.round(total(p[src].map((d) => ({ value: d[f] }))));

// Per-page % change vs the previous period (Google-Analytics style).
function pctChange(cur, prev, lowerIsBetter = false) {
  if (!cur && !prev) return null; // nothing to compare
  let pct = prev === 0 ? (cur > 0 ? 100 : 0) : ((cur - prev) / prev) * 100;
  pct = Math.round(pct) || 0; // normalize -0 (and NaN) to 0
  const effective = lowerIsBetter ? -pct : pct;
  return { pct, dir: effective > 0 ? 'up' : effective < 0 ? 'down' : 'flat' };
}

function pageSummary(p, prev) {
  const cur = {
    views: p.views ?? 0,
    bounceRate: p.bounceRate ?? 0,
    conversions: pageMetric(p, 'ga4', 'conversions'),
    clicks: pageMetric(p, 'searchConsole', 'clicks'),
    impressions: pageMetric(p, 'searchConsole', 'impressions'),
    position: pageWeightedPosition(p),
  };
  const pv = prev
    ? {
        views: prev.views ?? 0,
        bounceRate: prev.bounceRate ?? 0,
        conversions: pageMetric(prev, 'ga4', 'conversions'),
        clicks: pageMetric(prev, 'searchConsole', 'clicks'),
        impressions: pageMetric(prev, 'searchConsole', 'impressions'),
        position: pageWeightedPosition(prev),
      }
    : {};
  return {
    url: p.url,
    label: p.label,
    author: p.author || null,
    ...cur,
    deltas: {
      views: pctChange(cur.views, pv.views || 0),
      bounceRate: pctChange(cur.bounceRate, pv.bounceRate || 0, true), // lower bounce is better
      conversions: pctChange(cur.conversions, pv.conversions || 0),
      clicks: pctChange(cur.clicks, pv.clicks || 0),
      impressions: pctChange(cur.impressions, pv.impressions || 0),
      position: pctChange(cur.position, pv.position || 0, true),
    },
    modes: p.modes,
  };
}

function assessment(deltas, cwv) {
  // Turn signals into a plain-English health verdict for the team. Only signals
  // with enough traffic to be reliable count toward the verdict, so a couple of
  // sessions can't swing it to "Improving" or "Needs attention".
  const signals = [
    { key: 'organicClicks', label: 'Organic clicks', ...deltas.clicks },
    { key: 'traffic', label: 'Traffic (sessions)', ...deltas.sessions },
    { key: 'conversions', label: 'Conversions', ...deltas.conversions },
    { key: 'position', label: 'Avg. search position', ...deltas.position },
  ];
  const reliable = signals.filter((s) => s.reliable);

  let score = 0;
  for (const s of reliable) {
    if (s.direction === 'up') score += 1;
    else if (s.direction === 'down') score -= 1;
  }
  // Poor CWV drags the verdict down, but GOOD CWV does not push it up — a fast
  // page shouldn't mask a real traffic/clicks decline (that read as "Stable").
  const cwvPenalty = cwv?.overall === 'poor' ? -1 : 0;
  const net = score + (reliable.length ? cwvPenalty : 0);

  let verdict = 'Stable';
  let tone = 'neutral';
  const flags = [];

  if (!reliable.length) {
    verdict = 'Low volume';
    tone = 'neutral';
    flags.push('Not enough traffic in this period to assess reliably — widen the date range or switch region to All.');
    if (cwv?.overall === 'poor') flags.push('Core Web Vitals are poor — developer/performance work needed.');
    return { verdict, tone, score: 0, signals, flags };
  }

  // Symmetric: any net-negative reliable movement needs attention; net-positive
  // is improving; balanced is stable.
  if (net >= 1) {
    verdict = 'Improving';
    tone = 'good';
  } else if (net <= -1) {
    verdict = 'Needs attention';
    tone = 'bad';
  }

  const down = (d) => d.reliable && d.direction === 'down';
  const up = (d) => d.reliable && d.direction === 'up';
  if (down(deltas.sessions)) flags.push('Traffic (sessions) is declining — check acquisition, SEO, and paid mix.');
  if (down(deltas.clicks)) flags.push('Organic clicks are declining — SEO/content review.');
  if (down(deltas.position)) flags.push('Search rankings slipping — check on-page SEO & competitors.');
  if (down(deltas.conversions)) flags.push('Conversions down — review CTAs, forms, and offer.');
  if (cwv?.overall === 'poor') flags.push('Core Web Vitals are poor — developer/performance work needed.');
  if (up(deltas.traffic) && down(deltas.conversions))
    flags.push('Traffic up but conversions down — landing-page quality or intent mismatch.');
  if (!flags.length) flags.push('No red flags in this period. Keep it up.');

  return { verdict, tone, score: Number(net.toFixed(1)), signals, flags };
}

export function aggregateCombination(combo, currentPages, previousPages) {
  const traffic = sumBy(currentPages, 'ga4', 'sessions');
  const conversions = sumBy(currentPages, 'ga4', 'conversions');
  const clicks = sumBy(currentPages, 'searchConsole', 'clicks');
  const impressions = sumBy(currentPages, 'searchConsole', 'impressions');
  const position = weightedPosition(currentPages);
  const ppcClicks = sumBy(currentPages, 'ads', 'clicks');
  const ppcCost = sumBy(currentPages, 'ads', 'cost');
  const ppcConversions = sumBy(currentPages, 'ads', 'conversions');

  const prev = {
    traffic: sumBy(previousPages, 'ga4', 'sessions'),
    conversions: sumBy(previousPages, 'ga4', 'conversions'),
    clicks: sumBy(previousPages, 'searchConsole', 'clicks'),
    position: weightedPosition(previousPages),
    ppcClicks: sumBy(previousPages, 'ads', 'clicks'),
    ppcCost: sumBy(previousPages, 'ads', 'cost'),
  };

  const clicksVol = total(clicks) + total(prev.clicks);
  const deltas = {
    sessions: delta(traffic, prev.traffic, { minVolume: 30 }),
    conversions: delta(conversions, prev.conversions, { minVolume: 8 }),
    clicks: delta(clicks, prev.clicks, { minVolume: 20 }),
    // Ranking change is only meaningful when the pages actually get clicks.
    position: delta(position, prev.position, { lowerIsBetter: true, volume: clicksVol, minVolume: 20 }),
    ppcClicks: delta(ppcClicks, prev.ppcClicks),
    ppcCost: delta(ppcCost, prev.ppcCost),
    traffic: delta(traffic, prev.traffic, { minVolume: 30 }),
  };

  const cwv = rollupCWV(currentPages);

  return {
    id: combo.id,
    name: combo.name,
    owners: combo.owners,
    pageCount: currentPages.length,
    trends: {
      traffic,
      conversions,
      clicks,
      impressions,
      position,
      ppcClicks,
      ppcCost,
      ppcConversions,
    },
    totals: {
      pageViews: currentPages.reduce((a, p) => a + (p.views || 0), 0),
      sessions: Math.round(total(traffic)),
      conversions: Math.round(total(conversions)),
      clicks: Math.round(total(clicks)),
      impressions: Math.round(total(impressions)),
      avgPosition: position.length ? Number((total(position) / position.length).toFixed(1)) : 0,
      ppcClicks: Math.round(total(ppcClicks)),
      ppcCost: Number(total(ppcCost).toFixed(2)),
      ppcConversions: Math.round(total(ppcConversions)),
    },
    deltas,
    cwv,
    pages: (() => {
      const prevByUrl = {};
      for (const p of previousPages) prevByUrl[p.url] = p;
      return currentPages.map((p) => pageSummary(p, prevByUrl[p.url]));
    })(),
    assessment: assessment(deltas, cwv),
    errors: currentPages.reduce((acc, p) => {
      for (const [k, v] of Object.entries(p.errors || {})) acc[k] = v;
      return acc;
    }, {}),
  };
}
