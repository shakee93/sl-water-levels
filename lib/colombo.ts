// Colombo canal basins: which canal area a town belongs to, where it drains, and which CUrW gauges describe it.
// Facts (project completion report of the Metro Colombo Urban Development Project, research/colombo-canals.md):
//  - Kolonnawa basin drains to the Kelani through the North Lock pumps (30 m3/s) and gates at Nagalagam Street and the
//    Gothatuwa flood-bund gates; above 5 ft at Nagalagam Street the outfall stops working and pumping is the outlet.
//  - Parliament Lake (Diyawanna Oya) is held by gates; it drains north via the Kolonnawa canal and south via the Kotte
//    canals to the Wellawatta and Dehiwala outfalls on the coast.
//  - The north canals (Dematagoda, St Sebastian, Beira Lake) end in the Mutwal tunnel / North Canal at the Kelani mouth.
//  - Wellawatta, Kirulapone and Dehiwala canals end in the sea and are tidal.
import type { CKey } from "./i18n/colombo";

export type BasinId = "kolonnawa" | "parliament" | "north" | "wellawatta";
export type Basin = {
  id: BasinId;
  nameKey: CKey;
  drainKey: CKey;
  /** Town slugs (lib/places.ts) that belong to the basin, most relevant first. */
  towns: string[];
  /** CUrW gauge names (as archived in D1) that describe it, in the order shown. */
  gauges: string[];
  /** Chart page on pub.curwsl.org. */
  chart: string;
  /** Tidal outfall: judged by the sea. */
  tidal: boolean;
};

const CHART = "http://pub.curwsl.org/";
export const BASINS: Basin[] = [
  {
    id: "kolonnawa", nameKey: "basin.kolonnawa", drainKey: "drain.kolonnawa", tidal: true, chart: CHART,
    towns: ["wellampitiya", "kolonnawa", "kotikawatta", "mulleriyawa", "angoda", "meethotamulla", "gothatuwa", "orugodawatta", "sedawatta"],
    gauges: ["Wellampitiya N", "Kalupalama US", "Kalupalama DS", "Salalihini Mw", "Gothatuwa DS"],
  },
  {
    id: "parliament", nameKey: "basin.parliament", drainKey: "drain.parliament", tidal: false, chart: CHART,
    towns: ["rajagiriya", "battaramulla", "kotte", "pita-kotte", "ethul-kotte", "nawala", "koswatta", "thalangama"],
    gauges: ["Diyasaru Uyana Gate US", "Diyatha Bridge", "Kimbulawela", "Rampalawatta"],
  },
  {
    id: "north", nameKey: "basin.north", drainKey: "drain.north", tidal: true, chart: CHART,
    towns: ["dematagoda", "grandpass", "maradana", "borella", "bloemendhal", "kotahena", "mattakkuliya", "modara", "colombo"],
    gauges: ["Sedawatta Bridge DS", "Orugodawatta", "Ingurukade N", "Mattakkuliya N"],
  },
  {
    id: "wellawatta", nameKey: "basin.wellawatta", drainKey: "drain.wellawatta", tidal: true, chart: CHART,
    towns: ["wellawatta", "dehiwala", "kirulapone"],
    gauges: ["Wellawatta N", "Nawala Road", "Near Lanka Hospital", "Torinton Canal"],
  },
];

export const basinOfTown = (slug: string): Basin | undefined => BASINS.find((b) => b.towns.includes(slug));
/** Towns on the Nagalagam gauge's tide (it is tidal), where the tide line belongs. */
export const SEA_DRAINING = new Set(["wellawatta", "dehiwala", "kirulapone"]);

export type BasinStateKey = "higher" | "normal" | "lower" | "learning" | "offline";
/** One plain state for a basin from its gauges: "higher" when at least two (or all, if fewer) are rising or higher than usual. */
export function basinState(b: Basin, gauges: { name: string; state: string }[] | null | undefined): BasinStateKey {
  const own = (gauges ?? []).filter((g) => b.gauges.includes(g.name));
  const live = own.filter((g) => g.state !== "offline" && g.state !== "learning");
  if (!live.length) return own.some((g) => g.state === "learning") ? "learning" : "offline";
  const hi = live.filter((g) => g.state === "higher" || g.state === "rising").length;
  if (hi >= Math.min(2, live.length)) return "higher";
  if (live.filter((g) => g.state === "lower").length * 2 > live.length) return "lower";
  return "normal";
}
