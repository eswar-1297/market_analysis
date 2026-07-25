// US Eastern Time helpers for HubSpot date handling.
//
// Leads are bucketed and date-filtered by the US Eastern calendar day so the
// day boundaries line up with HubSpot's portal — NOT UTC, and NOT the server's
// local zone (on a host like Render that could be anything). America/New_York
// automatically handles the EST/EDT daylight-saving switch.

import { config } from '../config.js';

const TZ = config.hubspot.timezone; // 'America/New_York'

// Offset of TZ from UTC (ms) at noon on the given date. Noon avoids DST-switch
// ambiguity (transitions happen ~02:00) and carries no sub-second component.
export function tzOffsetMs(y, mo, d) {
  const noon = Date.UTC(y, mo - 1, d, 12, 0, 0);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(noon));
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  const tzAsUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return tzAsUtc - noon; // negative for Eastern Time
}

// UTC epoch ms of ET midnight (start of day) for a YYYY-MM-DD date.
export function etMidnightMs(dateStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, mo - 1, d, 0, 0, 0, 0) - tzOffsetMs(y, mo, d);
}

// The next calendar day after a YYYY-MM-DD date, as YYYY-MM-DD.
export function nextDay(dateStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

// A UTC instant (epoch-ms string or ISO string) -> its ET calendar date,
// as YYYY-MM-DD. Used to bucket each contact into a day.
const etDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
export function toEtDate(instant) {
  if (!instant) return '';
  const ms = /^\d+$/.test(String(instant)) ? Number(instant) : Date.parse(instant);
  if (Number.isNaN(ms)) return '';
  return etDateFmt.format(new Date(ms)); // en-CA => YYYY-MM-DD
}
