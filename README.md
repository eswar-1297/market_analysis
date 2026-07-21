# CloudFuze Marketing Dashboard

An internal dashboard to monitor and **assess marketing performance per lead-gen
combination** (Slack to Teams, Box to Google Workspace, etc.). For each
combination you can see real **traffic, conversions, organic clicks &
impressions, search position, PPC, and Core Web Vitals** — as trend graphs —
plus a team-assessment layer (owners, period-over-period deltas, and health
flags for content / SEO / dev).

- **Frontend:** React + Vite + Recharts
- **Backend:** Node.js + Express
- **Data sources:** Google Analytics 4, Google Search Console, Google Ads (PPC),
  PageSpeed Insights / CrUX (Core Web Vitals)

> **It runs today with realistic sample data.** Each source independently
> switches to **real data** the moment you add its credentials to `.env`. You
> never have to wait until everything is connected — connect GA4 first, add
> Search Console later, and so on.

---

## 0. Deploy (production)

The app runs as **one Node process** that serves both the built UI and the API.

1. `npm run install:all && npm run build`
2. Set these **environment variables** on your host (do NOT upload `.env` — it's
   gitignored; set them in the platform's config):

   ```
   PORT=4000
   DASHBOARD_USER=CFMARKETING
   DASHBOARD_PASS=<your password>
   GA4_PROPERTY_ID=351699324
   SEARCH_CONSOLE_SITE_URL=https://www.cloudfuze.com/
   PAGESPEED_API_KEY=<key>
   GOOGLE_CREDENTIALS_B64=<full base64 of the service-account JSON>
   ```

   - `GOOGLE_CREDENTIALS_B64` accepts **base64 OR raw JSON**. You can also use
     `GOOGLE_CREDENTIALS_JSON` and paste the raw key-file contents.
   - Paste the **complete** value — a truncated base64 causes an
     "Unexpected token in JSON" error and the app falls back to sample data.
3. `npm start` (or run under PM2: `pm2 start ecosystem.config.cjs`).

The service account must be granted **Viewer** on the GA4 property and added as
a user on the Search Console property.

---

## 1. Install & run

Requires **Node.js 18+** (has built-in `fetch`). Check with `node -v`.

```bash
cd "marketing-dashboard"
npm run install:all      # installs server + client dependencies
npm run dev              # starts backend (:4000) and frontend (:5173)
```

Then open **http://localhost:5173**.

The top-right pill shows **Sample data** or **Live data**. With no `.env` it
shows sample data for all 19 combinations so you can explore the full UI
immediately.

To run as one production process instead:

```bash
npm run build            # builds the React app
npm start                # serves everything on http://localhost:4000
```

---

## 2. Connecting real data

Copy `.env.example` to `.env` and fill in what you have. Restart `npm run dev`
after editing. Fill sources in any order — each turns "live" on its own.

### A. Google Analytics 4  (traffic, conversions, engagement)

1. **Get the property ID:** GA4 → **Admin → Property Settings** → copy the
   numeric **Property ID** (e.g. `123456789`) into `GA4_PROPERTY_ID`.
2. Create a **service account** (see step C) and add its email as a **Viewer**
   in GA4 → **Admin → Property Access Management**.

### B. Google Search Console  (clicks, impressions, CTR, position, CWV)

1. Put the exact property string in `SEARCH_CONSOLE_SITE_URL` — either
   `https://www.cloudfuze.com/` (URL-prefix property) or
   `sc-domain:cloudfuze.com` (domain property). It must match Search Console
   exactly.
2. Add the **service account email** as a user in Search Console →
   **Settings → Users and permissions** (Full or Restricted).

### C. Service account (shared by GA4 + Search Console)

1. Go to **console.cloud.google.com** → create/select a project.
2. **APIs & Services → Enable APIs** → enable **Google Analytics Data API** and
   **Google Search Console API**.
3. **APIs & Services → Credentials → Create credentials → Service account**.
4. Open the service account → **Keys → Add key → JSON** → download it.
5. Save the file somewhere safe and set
   `GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\key.json`.
6. Grant that service account's email access in GA4 (step A2) and Search Console
   (step B2).

### D. PageSpeed Insights / CrUX  (real Core Web Vitals)

1. In the same Cloud project: **Enable APIs** → **PageSpeed Insights API**.
2. **Credentials → Create credentials → API key** → paste into
   `PAGESPEED_API_KEY`. (Works without a key but gets rate-limited quickly.)

### E. Google Ads  (PPC clicks, spend, conversions) — the most involved

1. Apply for a **developer token** in your Google Ads **manager (MCC)** account:
   **Tools → API Center**. Set `GOOGLE_ADS_DEVELOPER_TOKEN`.
2. Create an **OAuth client** (Cloud Console → Credentials → OAuth client ID →
   *Desktop app*). Set `GOOGLE_ADS_CLIENT_ID` and `GOOGLE_ADS_CLIENT_SECRET`.
3. Generate a **refresh token** for that client (Google's OAuth playground or
   the `google-ads-api` auth helper). Set `GOOGLE_ADS_REFRESH_TOKEN`.
4. Set `GOOGLE_ADS_CUSTOMER_ID` (the account with the ads, digits only, no
   dashes) and, if it's under an MCC, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`.

> Don't have all of these yet? Leave them blank — PPC shows sample data and
> everything else still works. Ads is the one to tackle last.

**Not sure what access you have?** Ask whoever administers Google Analytics /
Search Console / Google Ads for CloudFuze whether they can (a) add a service
account email as a viewer, and (b) share the GA4 property ID. That unlocks GA4 +
Search Console + Core Web Vitals — the bulk of the dashboard — without touching
Google Ads.

---

## 3. How the assessment layer works

- **Owners:** assign a content writer, SEO owner, and developer per combination
  (saved to `data/owners.json`). This is who you assess.
- **Deltas:** every metric is compared to the immediately preceding period of
  the same length (28d vs the prior 28d, etc.).
- **Health verdict** per combination: *Improving / Stable / Needs attention*,
  derived from clicks, traffic, conversions, position, and Core Web Vitals.
- **Flags:** plain-English callouts that point to the responsible team, e.g.
  *"Core Web Vitals are poor — developer/performance work needed"* or
  *"Traffic up but conversions down — landing-page quality or intent mismatch."*

The colored dot next to each combination in the sidebar reflects its current
verdict once you open it.

---

## 4. Editing the combinations / pages

The combination → page mapping lives in `data/combinations.json` (generated from
your `Lead Gen pages access for Satya.xlsx`). Add pages or combinations by
editing that file — no code change needed.

---

## 5. Project structure

```
marketing-dashboard/
├─ data/
│  ├─ combinations.json     # 19 combinations → 45 pages (edit to add more)
│  └─ owners.json           # saved owner assignments
├─ server/
│  ├─ index.js              # Express API
│  ├─ config.js             # reads .env, decides live vs sample per source
│  ├─ connectors/           # ga4, searchConsole, googleAds, pagespeed, mock
│  └─ services/             # fetch orchestration + aggregation + assessment
└─ client/                  # React + Vite + Recharts UI
```
