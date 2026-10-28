import type { NextConfig } from "next";

// The old address and the paths that keep working there after the move (see redirects below).
const SITE = "https://waterlevels.lk";
const OLD_HOST = "sl-water-levels.vercel.app";
// An app opened from the iPhone/iPad Home Screen: its user agent names the device but has no "Safari" token (Safari's does).
const IOS_HOME_SCREEN_APP = "^(?!.*Safari).*(iPhone|iPad).*$";
const OLD_KEEP = "(?!api/|api$|mcp|_next/|sw\\.js|manifest|favicon|icon|apple-icon|robots\\.txt)";

// Station, river, reservoir and town pages render per request and stream (heading and answer first),
// so the CDN has to cache them from headers: 60 s fresh, then 5 min served stale while a new copy
// renders. Vercel-CDN-Cache-Control is read only by Vercel's CDN (not sent to browsers) and wins over the
// Cache-Control that Next sets on a dynamic render. Pages not listed here are static or ISR.
const CDN = "public, s-maxage=60, stale-while-revalidate=300";
const headers = [
  { key: "Vercel-CDN-Cache-Control", value: CDN },
  { key: "CDN-Cache-Control", value: CDN },
];
// /<river> and /<river>/<gauge>, minus the fixed top-level pages, the locale prefixes and the image routes.
const FIXED = "about|help|status|data|history|flood|flood-survey|reservoirs|research|news|embed|si|ta|en";
const river = `:river((?!(?:${FIXED})$)[^/]+)`;
const leaf = ":leaf((?!opengraph-image|twitter-image)[^/]+)";

const nextConfig: NextConfig = {
  // app/global-not-found.tsx: the body of the 404 that proxy.ts returns for addresses that do not exist (no root layout to compose it from).
  experimental: { globalNotFound: true },
  images: {
    // Reservoir photos (app/ReservoirPhotos.tsx) are Wikimedia Commons thumbnails and nothing else.
    remotePatterns: [{ protocol: "https", hostname: "upload.wikimedia.org", pathname: "/wikipedia/commons/**", search: "" }],
  },
  async redirects() {
    return [
      // /rain-map was shared as the rain map's address before the page settled on /rain.
      { source: "/rain-map", destination: "/rain", permanent: true },
      { source: "/:lang(si|ta)/rain-map", destination: "/:lang/rain", permanent: true },
      // www.waterlevels.lk -> waterlevels.lk: one address for search engines and sharing
      { source: "/:path*", has: [{ type: "host", value: "www.waterlevels.lk" }], destination: "https://waterlevels.lk/:path*", permanent: true },
      // The move to waterlevels.lk (MIGRATION.md): every page on the old address goes to the same page there, permanently,
      // so search engines carry each page's ranking across. Left working on the old address: /api (apps, scripts, POSTs from
      // pages already open), /mcp, Next's own files, the service worker and the manifest (installed apps and push alerts),
      // and /api/move. Visitors whose phone keeps saved places (cookie sl_has_data, app/SavedDataMarker.tsx) are rewritten to
      // /api/move instead (below), which carries their data across first.
      {
        source: `/:path(${OLD_KEEP}.*)`,
        has: [{ type: "host", value: OLD_HOST }],
        missing: [{ type: "cookie", key: "sl_has_data" }, { type: "header", key: "user-agent", value: IOS_HOME_SCREEN_APP }],
        destination: `${SITE}/:path`,
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        { source: `/:path(${OLD_KEEP}.*)`, has: [{ type: "host", value: OLD_HOST }, { type: "cookie", key: "sl_has_data" }], destination: "/api/move?to=/:path" },
        // the app installed on an iPhone/iPad Home Screen keeps its own storage, and may never have got the cookie: always hand over
        { source: `/:path(${OLD_KEEP}.*)`, has: [{ type: "host", value: OLD_HOST }, { type: "header", key: "user-agent", value: IOS_HOME_SCREEN_APP }], destination: "/api/move?to=/:path" },
      ],
    };
  },
  async headers() {
    const lang = ["", "/:lang(si|ta)"];
    // The embeddable widgets (/embed/<widget>): the only pages any site may frame, never indexed, cached like the other live pages.
    // (The /embed guide page and every other page keep the default framing policy.)
    const WIDGET = "/embed/:widget(card|river|gauge|forecast|town|now|reservoirs|ticker)";
    const embedHeaders = [
      ...headers,
      { key: "Content-Security-Policy", value: "frame-ancestors *" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ];
    const embeds = [{ source: WIDGET, headers: embedHeaders }, { source: `${WIDGET}/:slug*`, headers: embedHeaders }];
    return embeds.concat(lang.flatMap((l) => [
      { source: `${l}/${river}`, headers },
      { source: `${l}/${river}/${leaf}`, headers },
      { source: `${l}/flood/:town`, headers },
      { source: `${l}/reservoirs/:slug`, headers },
      { source: `${l}/news`, headers },
    ])).concat([
      // sitemap renders on request (app/sitemap.ts): one copy an hour from the CDN
      { source: "/sitemap.xml", headers: [{ key: "Vercel-CDN-Cache-Control", value: "public, s-maxage=3600, stale-while-revalidate=86400" }, { key: "CDN-Cache-Control", value: "public, s-maxage=3600, stale-while-revalidate=86400" }] },
    ]);
  },
};

export default nextConfig;
