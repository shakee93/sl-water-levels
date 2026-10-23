// One place for what search engines and answer engines read: the site's identity, the JSON-LD
// builders every page type shares, and the IndexNow key. Pure (no I/O), safe in any component.
//
// Rules this file keeps: every fact in JSON-LD is also visible on the page; dates are ISO 8601;
// the publisher is a person (the owner), because there is no company behind the site.
import { localePath, type Locale } from "./i18n/config";

export const SITE = "https://sl-water-levels.vercel.app";
export const SITE_NAME = "Sri Lanka Water Levels";
export const OWNER = { name: "Shakeeb Sadikeen", x: "https://x.com/shakeeb_x", github: "https://github.com/shakee93" } as const;
export const REPO = "https://github.com/shakee93/sl-water-levels";
export const DATA_BRANCH = `${REPO}/tree/data`;

/** When the About / Data / Help text last changed in substance. Bump it when you edit those pages. */
export const CONTENT_UPDATED = "2026-10-24";

/** Flip to true when /research is live; the About page then links to it. */
export const RESEARCH_PAGE_LIVE = false;

/** IndexNow key (the file public/<key>.txt must contain exactly this string). Not a secret by design. */
export const INDEXNOW_KEY = "e003239ac7a5178cc4f97e46e533c488";

export const abs = (lang: Locale, path: string) => {
  const p = localePath(lang, path);
  return SITE + (p === "/" ? "" : p);
};

export const PUBLISHER_ID = `${SITE}/#publisher`;
export const WEBSITE_ID = `${SITE}/#website`;

export const publisherLd = () => ({
  "@type": "Person",
  "@id": PUBLISHER_ID,
  name: OWNER.name,
  url: OWNER.x,
  sameAs: [OWNER.x, OWNER.github],
});

export const websiteLd = (lang: Locale, description: string) => ({
  "@type": "WebSite",
  "@id": WEBSITE_ID,
  name: SITE_NAME,
  url: SITE,
  inLanguage: ["en", "si", "ta"],
  description,
  publisher: { "@id": PUBLISHER_ID },
  // The site search is a client-side box with no URL of its own, so there is no SearchAction to declare.
});

/** WebPage with the freshness and "read this aloud" hints. */
export function webPageLd(o: {
  lang: Locale;
  path: string;
  name: string;
  description: string;
  modified?: number | string | null;
  /** CSS selectors of the answer text (see <AnswerLine>). */
  speakable?: string[];
  type?: "WebPage" | "AboutPage" | "CollectionPage" | "FAQPage";
}) {
  const modified = o.modified == null ? undefined : new Date(o.modified).toISOString();
  return {
    "@type": o.type ?? "WebPage",
    "@id": `${abs(o.lang, o.path)}#webpage`,
    url: abs(o.lang, o.path),
    name: o.name,
    description: o.description,
    inLanguage: o.lang,
    isPartOf: { "@id": WEBSITE_ID },
    publisher: { "@id": PUBLISHER_ID },
    ...(modified ? { dateModified: modified } : {}),
    ...(o.speakable?.length ? { speakable: { "@type": "SpeakableSpecification", cssSelector: o.speakable } } : {}),
  };
}

export function breadcrumbLd(items: { name: string; path: string }[], lang: Locale) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: abs(lang, it.path) })),
  };
}

export function faqLd(items: { q: string; a: string }[]) {
  return {
    "@type": "FAQPage",
    mainEntity: items.map((x) => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a } })),
  };
}

export function placeLd(o: { name: string; lat: number; lon: number; url: string; containedIn?: string; type?: string }) {
  return {
    "@type": o.type ?? "Place",
    name: o.name,
    url: o.url,
    geo: { "@type": "GeoCoordinates", latitude: o.lat, longitude: o.lon },
    ...(o.containedIn ? { containedInPlace: { "@type": "Place", name: o.containedIn } } : {}),
  };
}

/** The site-wide dataset: current levels for every gauge, reservoir releases, and the archive. */
export const siteDatasetLd = () => ({
  "@type": "Dataset",
  "@id": `${SITE}/data#dataset`,
  name: "Sri Lanka river water levels, flood marks and reservoir releases (live)",
  description:
    "Hourly river-gauge water levels for 40+ Sri Lankan gauges with the official alert, minor flood and major flood marks, plus daily reservoir storage and spill/release figures. Compiled from Department of Irrigation and Mahaweli Authority publications. Not an official warning service.",
  url: `${SITE}/data`,
  inLanguage: "en",
  isAccessibleForFree: true,
  license: `${SITE}/about#data-sources`,
  creator: { "@id": PUBLISHER_ID },
  publisher: { "@id": PUBLISHER_ID },
  isBasedOn: [
    "https://www.irrigation.gov.lk/",
    "https://www.dmc.gov.lk/",
    "https://mahaweli.gov.lk/",
  ],
  keywords: ["Sri Lanka", "flood", "river level", "water level", "reservoir", "spill gates", "Kelani Ganga", "Department of Irrigation"],
  temporalCoverage: "2026-10-01/..",
  spatialCoverage: { "@type": "Place", name: "Sri Lanka", geo: { "@type": "GeoShape", box: "5.9 79.5 9.9 81.9" } },
  variableMeasured: [
    { "@type": "PropertyValue", name: "River water level", unitText: "feet" },
    { "@type": "PropertyValue", name: "Flood marks (alert, minor, major)", unitText: "feet" },
    { "@type": "PropertyValue", name: "Reservoir storage", unitText: "percent" },
    { "@type": "PropertyValue", name: "Reservoir spill or release", unitText: "cusecs" },
  ],
  distribution: [
    { "@type": "DataDownload", name: "Current river levels (JSON)", encodingFormat: "application/json", contentUrl: `${SITE}/api/levels` },
    { "@type": "DataDownload", name: "Reservoirs (JSON)", encodingFormat: "application/json", contentUrl: `${SITE}/api/reservoirs` },
    { "@type": "DataDownload", name: "Alerts feed (Atom)", encodingFormat: "application/atom+xml", contentUrl: `${SITE}/feed.xml` },
    { "@type": "DataDownload", name: "Archive of past readings and releases", encodingFormat: "application/x-ndjson", contentUrl: DATA_BRANCH },
  ],
});

/** Serialise for <script type="application/ld+json">: "<" is escaped so page text can never close the tag. */
export const ldJson = (graph: unknown[]) =>
  JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
