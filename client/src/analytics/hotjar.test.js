// Run with: npm test  (node --test -- no test framework is added to the repo)
//
// These cases cover the decision logic in hotjar.js, which is where the bugs live: is
// the ID present, is it digits-only, has the snippet already been injected. The DOM
// surface the module touches is tiny (getElementById / createElement / head.appendChild),
// so it is stubbed explicitly below rather than pulling in jsdom.
import test from 'node:test';
import assert from 'node:assert/strict';

// The module resolves the site ID on each call, so one import serves every case -- only
// the fake window/document need swapping between them.
const mod = await import('./hotjar.js');

function loadWith(hotjarSiteId) {
  const head = {
    children: [],
    appendChild(node) {
      this.children.push(node);
      return node;
    },
  };
  const document = {
    head,
    getElementById: (id) => head.children.find((n) => n.id === id) || null,
    createElement: () => ({ id: '', async: false, src: '' }),
  };
  const window = { __APP_CONFIG__: { hotjarSiteId } };

  globalThis.window = window;
  globalThis.document = document;

  return { mod, window, document };
}

test('does nothing when no site ID is configured', async () => {
  const { mod, window, document } = loadWith('');
  assert.equal(mod.isHotjarEnabled(), false);
  assert.equal(mod.initHotjar(), false);
  assert.equal(document.getElementById('hotjar-snippet'), null);
  // The important part of "off": nothing was even queued for the remote script to read.
  assert.equal(window._hjSettings, undefined);
  assert.equal(window.hj, undefined);
});

test('an unsubstituted __PLACEHOLDER__ falls through and stays off', async () => {
  const { mod } = loadWith('__HOTJAR_SITE_ID__');
  assert.equal(mod.isHotjarEnabled(), false);
  assert.equal(mod.initHotjar(), false);
});

test('injects once and sets a numeric hjid', async () => {
  const { mod, window, document } = loadWith('1234567');
  assert.equal(mod.isHotjarEnabled(), true);
  assert.equal(mod.initHotjar(), true);

  const script = document.getElementById('hotjar-snippet');
  assert.ok(script, 'the snippet script element should exist');
  assert.equal(script.async, true);
  assert.equal(script.src, 'https://static.hotjar.com/c/hotjar-1234567.js?sv=6');

  // Number, not string -- the remote script reads this value back.
  assert.equal(window._hjSettings.hjid, 1234567);
  assert.equal(typeof window._hjSettings.hjid, 'number');
  assert.equal(window._hjSettings.hjsv, 6);

  // Idempotent: StrictMode double-invocation must not open a second recording.
  assert.equal(mod.initHotjar(), false);
  assert.equal(document.head.children.length, 1);
});

test('refuses a non-numeric site ID and says why', async () => {
  const { mod, window } = loadWith('site-1234567');
  const original = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    assert.equal(mod.initHotjar(), false);
  } finally {
    console.warn = original;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /digits/);
  assert.equal(window._hjSettings, undefined);
});

test('identify queues the lowercased email once Hotjar is on', async () => {
  const { mod, window } = loadWith('1234567');
  mod.initHotjar();

  assert.equal(mod.identifyHotjarUser({ email: '  Jane.Doe@CloudFuze.com ' }), true);
  // Queued rather than sent: the remote script has not loaded in this test, which is
  // exactly the first-render case the queue exists for.
  assert.equal(window.hj.q.length, 1);
  assert.deepEqual([...window.hj.q[0]], ['identify', 'jane.doe@cloudfuze.com']);

  // No email (e.g. a deploy that predates the email in the auth redirect) => no call.
  assert.equal(mod.identifyHotjarUser({ email: '' }), false);
  assert.equal(mod.identifyHotjarUser(undefined), false);
  assert.equal(window.hj.q.length, 1);
});

test('identify is a no-op when Hotjar is off', async () => {
  const { mod, window } = loadWith('');
  assert.equal(mod.identifyHotjarUser({ email: 'jane.doe@cloudfuze.com' }), false);
  assert.equal(window.hj, undefined);
});
