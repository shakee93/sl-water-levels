// Legacy /history?scope=... links (rewritten here by proxy.ts) -> the clean history URL, 308.
// Accepts the first version's "b:<basin>" / "s:<gauge>" and plain slugs ("kelani-ganga", "hanwella").
import { NextResponse } from "next/server";
import { getHistory, historyPath } from "@/lib/history";
import { basinSlug, stationSlug } from "@/lib/slug";
import { isLocale, localePath } from "@/lib/i18n/config";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ lang: string; scope: string }> }) {
  const { lang, scope: raw } = await ctx.params;
  const l = isLocale(lang) ? lang : "en";
  const scope = decodeURIComponent(raw);
  const data = await getHistory();
  let target = "/history";
  if (data) {
    const basin =
      data.stations.find((s) => (scope.startsWith("b:") ? s.basin === scope.slice(2) : basinSlug(s.basin) === scope.toLowerCase()))?.basin;
    const gauge = data.stations.find((s) =>
      scope.startsWith("s:") ? s.station === scope.slice(2) : stationSlug(s.station) === scope.toLowerCase(),
    );
    if (basin && !scope.startsWith("s:")) target = historyPath(basin);
    else if (gauge) target = historyPath(gauge.basin, gauge.station);
  }
  return NextResponse.redirect(new URL(localePath(l, target), req.url), 308);
}
