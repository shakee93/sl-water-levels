// Atom feed of what needs attention: gauges at alert level or above, and reservoirs spilling or
// releasing water. English. Entries are stable per (item, state), so a reader sees a new entry when
// something changes state, not on every refresh. An empty feed is valid: it means all is calm.
import { getNational } from "@/lib/arcgis";
import { levelRecord } from "@/lib/apiData";
import { getReservoirs } from "@/lib/reservoirData";
import { SITE, SITE_NAME, OWNER } from "@/lib/seo";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Entry = { id: string; title: string; url: string; updated: string; summary: string };

export async function GET() {
  const now = Date.now();
  const [national, rsv] = await Promise.all([getNational().catch(() => null), getReservoirs().catch(() => null)]);
  if (!national && !rsv) return new Response("Source temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });

  const entries: Entry[] = [];
  for (const s of national ?? []) {
    const r = levelRecord(s, now);
    if (!["alert", "minor", "major"].includes(r.status) || !r.observedAt) continue;
    entries.push({
      id: `tag:sl-water-levels.vercel.app,2026:gauge:${r.id}:${r.status}`,
      title: `${r.station}, ${r.river}: ${r.statusLabel} (${r.level} ft)`,
      url: r.url,
      updated: r.observedAt,
      summary: `${r.station} on the ${r.river} read ${r.level} ft at ${r.observedAt} (UTC), ${r.statusLabel.toLowerCase()}${r.trend ? `, ${r.trend}` : ""}. Marks: alert ${r.marks.alert ?? "n/a"} ft, minor flood ${r.marks.minor ?? "n/a"} ft, major flood ${r.marks.major ?? "n/a"} ft.`,
    });
  }
  for (const r of rsv?.items ?? []) {
    if ((r.status !== "spilling" && r.status !== "releasing") || !r.flow || !r.latestDay) continue;
    entries.push({
      id: `tag:sl-water-levels.vercel.app,2026:reservoir:${r.slug}:${r.status}:${r.latestDay}`,
      title: `${r.name} reservoir is ${r.status} water (${Math.round(r.flow.cusecs)} cusecs)`,
      url: `${SITE}/reservoirs/${r.slug}`,
      updated: `${r.latestDay}T09:00:00+05:30`,
      summary: `${r.name}${r.river ? ` on the ${r.river}` : ""} was ${r.status} about ${Math.round(r.flow.cusecs)} cubic feet per second on ${r.latestDay} (${r.flow.source}).`,
    });
  }
  entries.sort((a, b) => (a.updated < b.updated ? 1 : -1));
  const updated = entries[0]?.updated ?? new Date(now).toISOString();
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">
  <title>${esc(SITE_NAME)}: what needs attention</title>
  <subtitle>River gauges at alert level or above and reservoirs releasing water. Not an official warning service: call 117 in an emergency.</subtitle>
  <id>tag:sl-water-levels.vercel.app,2026:feed</id>
  <link rel="self" type="application/atom+xml" href="${SITE}/feed.xml"/>
  <link rel="alternate" type="text/html" href="${SITE}/"/>
  <updated>${new Date(updated).toISOString()}</updated>
  <author><name>${esc(OWNER.name)}</name><uri>${OWNER.x}</uri></author>
${entries
  .map(
    (e) => `  <entry>
    <id>${esc(e.id)}</id>
    <title>${esc(e.title)}</title>
    <link rel="alternate" type="text/html" href="${esc(e.url)}"/>
    <updated>${new Date(e.updated).toISOString()}</updated>
    <summary>${esc(e.summary)}</summary>
  </entry>`,
  )
  .join("\n")}
</feed>
`;
  return new Response(xml, {
    headers: { "Content-Type": "application/atom+xml; charset=utf-8", "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800", "Access-Control-Allow-Origin": "*" },
  });
}
