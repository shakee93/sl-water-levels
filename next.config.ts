import type { NextConfig } from "next";

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
const FIXED = "about|help|status|data|history|flood|reservoirs|si|ta|en";
const river = `:river((?!(?:${FIXED})$)[^/]+)`;
const leaf = ":leaf((?!opengraph-image|twitter-image)[^/]+)";

const nextConfig: NextConfig = {
  images: {
    // Reservoir photos (app/ReservoirPhotos.tsx) are Wikimedia Commons thumbnails and nothing else.
    remotePatterns: [{ protocol: "https", hostname: "upload.wikimedia.org", pathname: "/wikipedia/commons/**", search: "" }],
  },
  async headers() {
    const lang = ["", "/:lang(si|ta)"];
    return lang.flatMap((l) => [
      { source: `${l}/${river}`, headers },
      { source: `${l}/${river}/${leaf}`, headers },
      { source: `${l}/flood/:town`, headers },
      { source: `${l}/reservoirs/:slug`, headers },
    ]);
  },
};

export default nextConfig;
