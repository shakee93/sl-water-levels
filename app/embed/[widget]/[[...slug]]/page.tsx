import { connection } from "next/server";
import { notFound } from "next/navigation";
import { buildEmbed } from "@/lib/embedData";
import { cfgQuery, isWidget, parseCfg } from "@/lib/embedConfig";
import { EmbedApp } from "../../EmbedApp";

// One page for every widget: /embed/river/<river>, /embed/gauge/<gauge>, /embed/town/<town>, /embed/now, /embed/reservoirs, /embed/ticker.
// Rendered per request (CDN-cached 60 s, next.config.ts); the browser then re-reads /api/embed every 5 minutes.
export default async function EmbedPage({ params, searchParams }: { params: Promise<{ widget: string; slug?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const [{ widget, slug }, sp] = await Promise.all([params, searchParams]);
  if (!isWidget(widget)) notFound();
  const needsId = widget === "river" || widget === "gauge" || widget === "forecast" || widget === "town";
  if ((needsId && slug?.length !== 1) || (!needsId && slug?.length)) notFound();
  const cfg = parseCfg(sp);
  const id = slug?.[0]?.toLowerCase() ?? null;
  let payload = null;
  try {
    payload = await buildEmbed(widget, id, cfg);
  } catch {
    payload = null; // source down: the widget shows "trying again" and retries on its own
  }
  if (!payload && (needsId || widget === "ticker") && !(await isDown(widget, id, cfg))) notFound();
  // what the client re-reads: the same settings, in the JSON route's shape
  const q = new URLSearchParams({ w: widget, ...(id ? { id } : {}) });
  const extra = cfgQuery(cfg, widget);
  if (extra) new URLSearchParams(extra.slice(1)).forEach((v, k) => q.set(k, v));
  // hours also matters for the gauge default, which cfgQuery leaves out
  return <EmbedApp initial={payload} api={`/api/embed?${q.toString()}`} cfg={cfg} widget={widget} />;
}

/** True when the sources cannot be read at all (so a missing payload means "down", not "no such gauge"). */
async function isDown(widget: string, id: string | null, cfg: ReturnType<typeof parseCfg>): Promise<boolean> {
  try {
    const { getNational } = await import("@/lib/arcgis");
    await getNational();
    void widget; void id; void cfg;
    return false;
  } catch {
    return true;
  }
}
