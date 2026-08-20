// Runtime configuration -- read when the page loads, NOT compiled into the bundle.
// Vite copies client/public/ into dist/ verbatim, so this file is editable after a
// build: no rebuild, no toolchain, no Node.js required.
//
// NOTE for this repo's deploy topology: production runs from a Docker image built
// by .deploy/deploy-build.sh, so editing THIS file on the server changes nothing
// until the next image build. The switch that production actually reads is the
// HOTJAR_SITE_ID GitHub Actions repository variable (see .github/workflows/deploy.yml).
// This file is the local-dev override and the in-container emergency lever
// (docker cp a modified copy into /app/client/dist/runtime-config.js).
window.__APP_CONFIG__ = {
  // Hotjar Site ID (digits only). Not a secret: it ships inside client-side JavaScript
  // that any visitor can read. Blank = Hotjar fully off, no script requested, no
  // session recorded.
  //
  // Blank here does NOT switch off a bundle that already has an ID baked in at build
  // time -- a blank runtime value deliberately falls through to the build-time value.
  // To turn a built bundle off, clear the HOTJAR_SITE_ID repo variable and redeploy.
  hotjarSiteId: "",
};
