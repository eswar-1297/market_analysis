import { getHotjarSiteId } from '../config/runtimeConfig.js';

const SCRIPT_ID = 'hotjar-snippet';

// Snippet version Hotjar expects in both _hjSettings and the script URL. Bumping this
// is Hotjar's call, not ours -- it changes only when they ship a new loader contract.
const SNIPPET_VERSION = 6;

export function isHotjarEnabled() {
  return Boolean(getHotjarSiteId());
}

/**
 * Injects the Hotjar snippet. No-ops when no site ID is configured, which is the normal
 * state in local development and on any deploy that has not opted in.
 *
 * Idempotent on purpose: main.jsx renders inside React.StrictMode, which double-invokes
 * effects in development, and two copies of the snippet would open two recordings for
 * one page view.
 *
 * @returns {boolean} true only when this call actually injected the script.
 */
export function initHotjar() {
  const siteId = getHotjarSiteId();
  if (!siteId) return false;
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (document.getElementById(SCRIPT_ID)) return false;

  // A non-numeric ID would silently request hotjar-NaN.js and fail with nothing in the
  // console pointing at the cause. Say so instead -- a typo'd ID and a deliberately
  // disabled Hotjar should not look identical to whoever is debugging.
  if (!/^\d+$/.test(siteId)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[analytics] Ignoring hotjarSiteId="${siteId}": a Hotjar Site ID is digits ` +
        `only (e.g. "1234567"). Find it under Settings -> Sites & Organizations in Hotjar. ` +
        `Recording is off.`
    );
    return false;
  }

  // The queue has to exist before the remote script loads, so calls made during the
  // first render -- identify, in particular -- are replayed instead of dropped.
  window.hj =
    window.hj ||
    function () {
      (window.hj.q = window.hj.q || []).push(arguments);
    };
  // Number, not string: Hotjar's own snippet emits `hjid:1234567` as a numeric literal
  // and the remote script reads this value back. The digits-only guard above means
  // Number() cannot produce NaN here.
  window._hjSettings = { hjid: Number(siteId), hjsv: SNIPPET_VERSION };

  const script = document.createElement('script');
  script.id = SCRIPT_ID;
  script.async = true;
  script.src = `https://static.hotjar.com/c/hotjar-${siteId}.js?sv=${SNIPPET_VERSION}`;
  document.head.appendChild(script);
  return true;
}

/**
 * Tags the current recording with who is using the dashboard, so recordings can be
 * filtered per person.
 *
 * Email is the right identifier here: sign-in is Microsoft Entra ID restricted to
 * config.ms.allowedDomains (server/index.js), so every user is an internal employee --
 * there are no customer or public accounts to pseudonymise.
 *
 * Note: filtering by these attributes is a paid Hotjar feature. On a tier without it the
 * call is accepted and ignored, so this stays safe to ship regardless of plan.
 *
 * @param {{email?: string}} user
 * @returns {boolean} true only when an identify call was actually sent.
 */
export function identifyHotjarUser(user) {
  if (!isHotjarEnabled()) return false;
  if (typeof window === 'undefined' || typeof window.hj !== 'function') return false;

  // Lowercased to match the case-insensitive email rule the server already follows when
  // it checks allowedDomains. Without it, one person signing in as Jane.Doe@ and
  // jane.doe@ appears as two different Hotjar users.
  const email = (user?.email || '').trim().toLowerCase();
  if (!email) return false;

  // The dashboard has no per-user role concept (access is all-or-nothing by email
  // domain), so nothing is passed beyond the identifier -- inventing a role attribute
  // would just add a constant to every recording.
  window.hj('identify', email);
  return true;
}
