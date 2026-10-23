// Raw release data (Irrigation Department sheet rows that matter, Mahaweli PDF rows, news
// detections) as JSON. Read every 15 minutes by .github/workflows/releases-snapshot.yml, which keeps
// each changed snapshot on the data branch so the forecast can later learn how long water takes.
// Public data only; the sources are cached for 10 minutes to an hour, so repeated hits are cheap.

import { getReleaseSources, getReleases } from "@/lib/releases";

export const revalidate = 300;

export async function GET() {
  const [src, merged] = await Promise.all([getReleaseSources(), getReleases()]);
  const iso = (ms: number) => new Date(ms).toISOString();
  return Response.json({
    // Every sheet row (about 170 reservoirs): the reservoir pages chart each one's water level from this archive.
    sheet: src.sheet.ok
      ? {
          sheetDate: src.sheet.data.sheetDate,
          fetchedAt: iso(src.sheet.data.fetchedAt),
          rows: src.sheet.data.rows,
        }
      : { error: src.sheet.error },
    wms: src.wms.ok
      ? {
          reportDate: src.wms.data.reportDate,
          lastModified: src.wms.data.lastModified,
          fetchedAt: iso(src.wms.data.fetchedAt),
          rows: src.wms.data.rows,
        }
      : { error: src.wms.error },
    news: src.news.ok ? { detections: src.news.data } : { error: src.news.error },
    active: merged.releases.map((r) => ({ reservoirId: r.reservoirId, kind: r.kind, cusecs: r.cusecs, source: r.source, observedAt: r.observedAt })),
  });
}
