// Read-only MCP server exposed at /mcp, so Claude (Desktop / org connector) can
// answer marketing questions against our GA4, Search Console, and Google Ads
// accounts in plain English. Everything here is READ-ONLY, and the property /
// site / customer IDs are baked in from config — users never pass them.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { google } from 'googleapis';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { config } from './config.js';
import { getGoogleAuth } from './connectors/googleAuth.js';
import { adsQuery } from './connectors/googleAds.js';
import { getOverview } from './services/overview.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMBOS_FILE = path.join(__dirname, '..', 'data', 'combinations.json');
const analyticsdata = google.analyticsdata('v1beta');

const asText = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
const asError = (msg) => ({ isError: true, content: [{ type: 'text', text: `Error: ${msg}` }] });

// Build a fresh MCP server (stateless — one per request) with all read-only tools.
export function buildMcpServer() {
  const server = new McpServer({ name: 'cloudfuze-marketing', version: '1.0.0' });

  // --- Google Analytics 4 (property baked in) -------------------------------
  server.tool(
    'ga4_run_report',
    `Run a Google Analytics 4 report for CloudFuze's property (${config.ga4PropertyId}). ` +
      'Read-only. Provide GA4 dimension and metric API names. Dates are YYYY-MM-DD or ' +
      'relative like "28daysAgo"/"today". Example dimensions: date, ' +
      'sessionDefaultChannelGroup, country, landingPage, deviceCategory. Example metrics: ' +
      'sessions, activeUsers, screenPageViews, keyEvents, engagementRate, averageSessionDuration.',
    {
      dimensions: z.array(z.string()).default(['sessionDefaultChannelGroup']),
      metrics: z.array(z.string()).default(['sessions', 'keyEvents']),
      startDate: z.string().default('28daysAgo'),
      endDate: z.string().default('today'),
      limit: z.number().int().positive().max(10000).default(100),
    },
    async ({ dimensions, metrics, startDate, endDate, limit }) => {
      try {
        const res = await analyticsdata.properties.runReport({
          auth: getGoogleAuth(),
          property: `properties/${config.ga4PropertyId}`,
          requestBody: {
            dateRanges: [{ startDate, endDate }],
            dimensions: dimensions.map((name) => ({ name })),
            metrics: metrics.map((name) => ({ name })),
            limit,
          },
        });
        const rows = (res.data.rows || []).map((r) => {
          const o = {};
          dimensions.forEach((d, i) => (o[d] = r.dimensionValues?.[i]?.value));
          metrics.forEach((m, i) => (o[m] = r.metricValues?.[i]?.value));
          return o;
        });
        return asText({ property: config.ga4PropertyId, dateRange: { startDate, endDate }, rowCount: rows.length, rows });
      } catch (e) {
        return asError(e.message);
      }
    }
  );

  // --- Search Console (site baked in) ---------------------------------------
  server.tool(
    'gsc_search_analytics',
    `Query Google Search Console performance for ${config.scSiteUrl}. Read-only. ` +
      'Dimensions can include: query, page, country, device, date, searchAppearance. ' +
      'Returns clicks, impressions, ctr, position.',
    {
      dimensions: z.array(z.string()).default(['query']),
      startDate: z.string().describe('YYYY-MM-DD'),
      endDate: z.string().describe('YYYY-MM-DD'),
      rowLimit: z.number().int().positive().max(25000).default(50),
    },
    async ({ dimensions, startDate, endDate, rowLimit }) => {
      try {
        const webmasters = google.searchconsole({ version: 'v1', auth: getGoogleAuth() });
        const res = await webmasters.searchanalytics.query({
          siteUrl: config.scSiteUrl,
          requestBody: { startDate, endDate, dimensions, rowLimit },
        });
        const rows = (res.data.rows || []).map((r) => {
          const o = {};
          dimensions.forEach((d, i) => (o[d] = r.keys?.[i]));
          o.clicks = r.clicks || 0;
          o.impressions = r.impressions || 0;
          o.ctr = Number(((r.ctr || 0) * 100).toFixed(2));
          o.position = Number((r.position || 0).toFixed(1));
          return o;
        });
        return asText({ site: config.scSiteUrl, dateRange: { startDate, endDate }, rowCount: rows.length, rows });
      } catch (e) {
        return asError(e.message);
      }
    }
  );

  // --- Google Ads (customer baked in, SELECT-only) --------------------------
  server.tool(
    'ads_query',
    `Run a READ-ONLY GAQL (Google Ads Query Language) SELECT query against CloudFuze's ` +
      `Ads account (${config.ads.customerId}). Only SELECT is allowed. Common resources: ` +
      'campaign, ad_group, keyword_view, expanded_landing_page_view. Common metrics: ' +
      'metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions. ' +
      'Use date filters like "segments.date DURING LAST_30_DAYS". cost_micros is micros ' +
      '(divide by 1,000,000 for dollars).',
    {
      query: z.string().describe('A GAQL SELECT statement.'),
    },
    async ({ query }) => {
      try {
        const rows = await adsQuery(query);
        return asText({ customerId: config.ads.customerId, rowCount: rows.length, rows });
      } catch (e) {
        return asError(e.message);
      }
    }
  );

  // --- Dashboard rollup: all combinations at a glance -----------------------
  server.tool(
    'combinations_overview',
    'High-level CloudFuze marketing overview: every migration combination (e.g. Slack to ' +
      'Teams) with its organic search metrics (impressions, clicks, avg position, views, ' +
      'bounce) and HubSpot organic leads. Read-only. Good starting point for "how is X doing".',
    {
      startDate: z.string().describe('YYYY-MM-DD'),
      endDate: z.string().describe('YYYY-MM-DD'),
      country: z.string().default('US').describe('ISO country code, or "ALL" for all regions.'),
    },
    async ({ startDate, endDate, country }) => {
      try {
        const combos = JSON.parse(fs.readFileSync(COMBOS_FILE, 'utf8')).combinations.filter((c) => !c.excludeFromOverview);
        const result = await getOverview(combos, startDate, endDate, country);
        return asText({ dateRange: { startDate, endDate }, country, rows: result.rows });
      } catch (e) {
        return asError(e.message);
      }
    }
  );

  return server;
}

// Interim protection until full OAuth is in place: if MCP_TOKEN is set, require
// `Authorization: Bearer <MCP_TOKEN>`. This keeps the public endpoint from
// exposing GA/Ads data to anyone with the URL. Left open only when MCP_TOKEN is
// unset (local dev). Replaced by per-user OAuth for the org connector.
function mcpAuthOk(req) {
  const required = (process.env.MCP_TOKEN || '').trim();
  if (!required) return true; // local dev — no token configured
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  return scheme === 'Bearer' && token === required;
}

// Mount the MCP endpoint on the Express app (stateless Streamable HTTP).
export function mountMcp(app, pathname = '/mcp') {
  app.post(pathname, async (req, res) => {
    if (!mcpAuthOk(req)) {
      return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
    }
    const server = buildMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      if (!res.headersSent) res.status(500).json({ error: e.message });
    }
  });
  // Stateless mode: GET/DELETE (session streams) aren't supported.
  const methodNotAllowed = (req, res) =>
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  app.get(pathname, methodNotAllowed);
  app.delete(pathname, methodNotAllowed);
}
