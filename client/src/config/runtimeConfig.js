// Resolves client configuration runtime-first, build-time-second.
//
// Why the runtime layer exists: Vite freezes import.meta.env values into the built
// JavaScript. A bundle built with tracking on could never be un-tracked without a
// rebuild, and one built without an ID could never be turned on. public/runtime-config.js
// is read from window.__APP_CONFIG__ instead, so the value stays changeable after a build.

// Treated as "not set": undefined, null, blank, and the "__PLACEHOLDER__" shape a
// container entrypoint might substitute at start-up -- an unsubstituted placeholder must
// fall through to the next source, not be used as a real value.
function isUnset(v) {
  if (typeof v !== 'string') return true;
  const t = v.trim();
  return !t || /^__.*__$/.test(t);
}

function resolve(runtimeValue, buildTimeValue) {
  for (const raw of [runtimeValue, buildTimeValue]) {
    if (!isUnset(raw)) return raw.trim();
  }
  return '';
}

// Optional chaining, not a bare property read: Vite replaces `import.meta.env` with a
// real object, while plain Node (used by the tests) leaves it undefined.
const BUILD_TIME_HOTJAR_SITE_ID = import.meta.env?.VITE_HOTJAR_SITE_ID;

function runtimeConfig() {
  return typeof window !== 'undefined' && window.__APP_CONFIG__ ? window.__APP_CONFIG__ : {};
}

/**
 * The Hotjar Site ID, or '' when Hotjar is off.
 *
 * Read on each call rather than frozen into a module-level constant. index.html loads
 * runtime-config.js as a blocking classic script before the module bundle, so in practice
 * the value is already there -- but reading lazily means this does not quietly depend on
 * that script-ordering detail, and it keeps the resolution testable.
 */
export function getHotjarSiteId() {
  return resolve(runtimeConfig().hotjarSiteId, BUILD_TIME_HOTJAR_SITE_ID);
}
