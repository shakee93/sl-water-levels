// The one list of public sections behind the footer and the phone More sheet, so the two cannot drift apart.
// Labels are the same strings the pages use for their breadcrumb / H1 (naming rule: one name per section).
// Basins (rivers) are listed separately by both, from live station data. Home, Towns, Reservoirs and News are also
// phone tabs, but are repeated in the sheet so that it alone is a complete index.
import { House, List, Map as MapIcon, MapPin, Waves, Droplets, CloudRain, Newspaper, History, Database, Activity, LifeBuoy, Info, FlaskConical, type LucideIcon } from "lucide-react";
import type { Locale } from "./i18n/config";
import { seoFor } from "./i18n/seo";
import { rtFor } from "./i18n/return";
import { rtFor as resFor } from "./i18n/reservoirs";
import { nwFor } from "./i18n/news";
import { rmFor } from "./i18n/rainMap";
import { statusT } from "./i18n/status";
import { DATA_NAV, NAV_GROUPS, RESEARCH } from "./i18n/footer";
import { ccFor } from "./i18n/colombo";

export type NavItem = { href: string; label: string; icon: LucideIcon; event: string };
export type NavGroup = { id: "levels" | "news" | "about"; heading: string; items: NavItem[] };

export function navGroups(lang: Locale, t: (k: "footer.home" | "crumb.allBasins" | "nav.history" | "nav.help" | "nav.about") => string): NavGroup[] {
  const g = NAV_GROUPS[lang];
  return [
    {
      id: "levels",
      heading: g.levels,
      items: [
        { href: "/", label: t("footer.home"), icon: House, event: "home_nav_click" },
        { href: "/rivers", label: t("crumb.allBasins"), icon: List, event: "rivers_nav_click" },
        { href: "/flood-map", label: seoFor(lang)("map.link"), icon: MapIcon, event: "flood_map_nav_click" },
        { href: "/flood", label: rtFor(lang)("tab.towns"), icon: MapPin, event: "towns_nav_click" },
        { href: "/reservoirs", label: resFor(lang)("nav"), icon: Waves, event: "reservoirs_nav_click" },
        { href: "/colombo-canals", label: ccFor(lang)("crumb"), icon: Droplets, event: "colombo_canals_nav_click" },
        { href: "/rain", label: rmFor(lang)("crumb"), icon: CloudRain, event: "rain_map_nav_click" },
      ],
    },
    {
      id: "news",
      heading: g.news,
      items: [
        { href: "/news", label: nwFor(lang)("nav"), icon: Newspaper, event: "news_nav_click" },
        { href: "/history", label: t("nav.history"), icon: History, event: "history_nav_click" },
        { href: "/data", label: DATA_NAV[lang], icon: Database, event: "data_nav_click" },
        { href: "/status", label: statusT(lang)("footer"), icon: Activity, event: "status_nav_click" },
      ],
    },
    {
      id: "about",
      heading: g.about,
      items: [
        { href: "/help", label: t("nav.help"), icon: LifeBuoy, event: "help_nav_click" },
        { href: "/about", label: t("nav.about"), icon: Info, event: "about_nav_click" },
        { href: "/research", label: RESEARCH[lang], icon: FlaskConical, event: "research_nav_click" },
      ],
    },
  ];
}
