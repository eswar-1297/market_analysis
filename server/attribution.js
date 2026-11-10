// Authorship attribution — the single source of truth for "who gets credit for
// this article, and which team are they on".
//
// Authorship is per ARTICLE, not per combination. The live CloudFuze site is the
// authority: data/page-authors.json maps every published URL to the author and
// publish date WordPress reports (see server/scripts/refresh-page-authors.mjs).
// Everything here is applied on top of that raw authorship.
//
// Business rules, as given:
//   Migrate team — Pankaj Rai, Preksha, Bhuvaneswari
//   Manage team  — Rashmi Ramesh, Aayushi
//
//   Two people changed teams, and their BACK CATALOGUE moves with the person who
//   owns that area now, not with whoever typed it:
//     - Bhuvaneswari wrote for Manage until 2026-11-03; anything of hers published
//       before that date is credited to Rashmi Ramesh (Manage). From 2026-11-03 it
//       stays hers (Migrate).
//     - Aayushi moved onto Manage on 2026-11-04; anything of hers published before
//       that date is credited to Pankaj Rai (Migrate). From 2026-11-04 it stays
//       hers (Manage).
//
//   Any author who is not one of those five — the legacy and shared bylines
//   (Arun Jyothi/cfeditor, Bhavani Asok, Shiva Remala, Saranya Ponugoti,
//   Tejeswini Devaraj, Adhithyan, Abhishek Chakraborty) — is credited to
//   Pankaj Rai on Migrate.
//
//   A page with no author at all is not an article: PPC ad and landing pages are
//   WordPress *pages* rather than posts, carry no byline, and belong to nobody.
//   resolveAuthorship() returns null for those, and they stay out of every
//   author view exactly as before.

export const TEAMS = { MANAGE: 'Manage', MIGRATE: 'Migrate' };

// Display roster, in the order the UI should list each team. These are the names
// shown to the reader, which are deliberately shorter than the full WordPress
// bylines ("Preksha" vs "Preksha Joshi").
export const ROSTER = {
  [TEAMS.MIGRATE]: ['Pankaj Rai', 'Preksha', 'Bhuvaneswari'],
  [TEAMS.MANAGE]: ['Rashmi Ramesh', 'Aayushi'],
};

const PANKAJ = 'Pankaj Rai';
const RASHMI = 'Rashmi Ramesh';

// Dates are compared as plain YYYY-MM-DD strings against the publish date the CMS
// reports in site-local time. That is what "written before November 3rd" means to
// the people who set these rules, and comparing date strings keeps the boundary
// free of timezone drift that UTC conversion would introduce around midnight.
const BHUVANESWARI_TO_MIGRATE = '2026-11-03';
const AAYUSHI_TO_MANAGE = '2026-11-04';

// WordPress identities -> the roster. Keyed by author slug first (stable even if
// someone's display name is edited in the CMS) with name fallbacks for safety.
const BY_SLUG = {
  pankajrai: PANKAJ,
  'preksha-joshi': 'Preksha',
  'bhuvaneswari-gireesh': 'Bhuvaneswari',
  'rashmi-ramesh': RASHMI,
  aayushi: 'Aayushi',
};
const BY_NAME = {
  'pankaj rai': PANKAJ,
  preksha: 'Preksha',
  'preksha joshi': 'Preksha',
  bhuvaneswari: 'Bhuvaneswari',
  'bhuvaneswari gireesh': 'Bhuvaneswari',
  'rashmi ramesh': RASHMI,
  aayushi: 'Aayushi',
  'aayushi raj': 'Aayushi',
  ayushi: 'Aayushi',
};

const TEAM_OF = {
  [PANKAJ]: TEAMS.MIGRATE,
  Preksha: TEAMS.MIGRATE,
  Bhuvaneswari: TEAMS.MIGRATE,
  [RASHMI]: TEAMS.MANAGE,
  Aayushi: TEAMS.MANAGE,
};

const datePart = (d) => (d ? String(d).slice(0, 10) : '');

/**
 * Resolve a raw byline to the person who should be credited and their team.
 *
 * @param {string|null} rawAuthor  author name as WordPress reports it
 * @param {string|null} publishedAt  ISO publish date; only the YYYY-MM-DD part is used
 * @param {string|null} slug  WordPress author slug, preferred over the name when present
 * @returns {{displayName: string, team: string, originalAuthor: string, reattributed: boolean}|null}
 *          null when there is no byline at all (ad/landing pages).
 */
export function resolveAuthorship(rawAuthor, publishedAt, slug) {
  const name = String(rawAuthor || '').trim();
  const slugKey = String(slug || '').trim().toLowerCase();
  if (!name && !slugKey) return null;

  const canonical = BY_SLUG[slugKey] || BY_NAME[name.toLowerCase()] || null;
  const on = datePart(publishedAt);

  let displayName;
  if (canonical === 'Bhuvaneswari') {
    // Her Manage-era back catalogue belongs to Rashmi. With no publish date we
    // cannot place the article relative to the cutover, so it stays with her
    // rather than being silently moved to another person's name.
    displayName = on && on < BHUVANESWARI_TO_MIGRATE ? RASHMI : 'Bhuvaneswari';
  } else if (canonical === 'Aayushi') {
    // Mirror image: her Migrate-era back catalogue belongs to Pankaj. An unknown
    // date keeps the article with her for the same reason.
    displayName = on && on < AAYUSHI_TO_MANAGE ? PANKAJ : 'Aayushi';
  } else if (canonical) {
    displayName = canonical;
  } else {
    // Legacy or shared byline — folds into Pankaj on Migrate.
    displayName = PANKAJ;
  }

  return {
    displayName,
    team: TEAM_OF[displayName] || TEAMS.MIGRATE,
    originalAuthor: name || slugKey,
    reattributed: Boolean(name) && displayName !== canonical,
  };
}

// Team for an already-resolved display name (used when only a name is in hand).
export function teamForDisplayName(displayName) {
  return TEAM_OF[displayName] || null;
}
