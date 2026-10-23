// Forgiving text matching for the reservoir search box. Both the typed query and each reservoir's
// names go through the same fold, so "Rantambe"/"Rantembe", "wewa"/"weva", "Kalawewa"/"Kala Wewa"
// and accented letters all meet. Sinhala and Tamil are compared as typed (only case/space folded).

export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/w/g, "v")
    .replace(/th/g, "t")
    .replace(/dh/g, "d")
    .replace(/sh/g, "s")
    .replace(/ph/g, "p")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .replace(/([a-z])\1+/g, "$1")
    .trim();
}

/** Haystack for one reservoir: every name it goes by, folded, with spaces removed as a second form. */
export function searchText(parts: (string | null | undefined)[]): string {
  const f = parts.filter((x): x is string => !!x).map(fold).join(" ");
  return `${f} ${f.replace(/ /g, "")}`;
}

/** Every word of the query must appear somewhere (so "kala wewa" and "kalawewa" both work). */
export function matches(hay: string, query: string): boolean {
  const q = fold(query);
  if (!q) return true;
  return q.split(" ").every((w) => hay.includes(w)) || hay.includes(q.replace(/ /g, ""));
}

export type SortKey = "release" | "full" | "name";
export type SortFields = { status: string; barrage: boolean; cusecs: number; pct: number | null; name: string };

/** Releasing most: anything spilling or releasing first (a routine barrage after the rest), biggest cusecs first, then fullest. */
export function compareRelease(a: SortFields, b: SortFields): number {
  const act = (x: SortFields) => (x.status === "spilling" || x.status === "releasing" ? 0 : 1);
  return act(a) - act(b) || Number(a.barrage) - Number(b.barrage) || b.cusecs - a.cusecs || (b.pct ?? -1) - (a.pct ?? -1) || a.name.localeCompare(b.name);
}
