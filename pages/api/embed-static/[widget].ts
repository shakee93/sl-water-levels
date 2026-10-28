// The embed widgets that carry no chart (river, town, right now, reservoirs, ticker) as plain HTML: the views are rendered on the server
// (app/embed/views.tsx) and the page ships one small stylesheet (/embed.css) and a ~1 KB script (/embed-live.js) that re-reads this same
// address every 5 minutes and swaps the content. No React, no Next runtime in the visitor's browser. Reached through the rewrite in
// next.config.ts, so the public address stays /embed/<widget>/<id>. Gauge, forecast and card (chart widgets) stay React pages.
// This is a Pages-router API route on purpose: the App Router refuses react-dom/server, and this one must send plain HTML.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { NextApiRequest, NextApiResponse } from "next";
import { buildEmbed } from "@/lib/embedData";
import { isWidget, parseCfg } from "@/lib/embedConfig";
import { styleOf } from "@/lib/embedStyle";
import { StaticView } from "@/app/embed/views";

const CACHE = "public, s-maxage=120, stale-while-revalidate=600";
const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
// ?theme=light|dark|auto before first paint (auto follows the visitor's OS)
const INIT = `(function(){try{var q=new URLSearchParams(location.search),t=q.get("theme"),d=t==="dark"||(t==="auto"&&matchMedia("(prefers-color-scheme: dark)").matches),r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light"}catch(e){}})()`;

type Out = { lang: string; dark: boolean; widget: string; status?: number };
function send(res: NextApiResponse, inner: string, o: Out) {
  const ok = !o.status || o.status === 200;
  const cache = ok ? CACHE : "public, s-maxage=60";
  const html = `<!doctype html><html lang="${o.lang}" class="${o.dark ? "dark" : ""}" style="color-scheme:${o.dark ? "dark" : "light"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="robots" content="noindex,nofollow"><title>Live river levels</title><link rel="stylesheet" href="/embed.css"><script>${INIT}</script></head><body class="text-slate-900 dark:text-slate-100" style="background:transparent">${inner}<script src="/embed-live.js" data-widget="${escAttr(o.widget)}" defer></script></body></html>`;
  res.status(o.status ?? 200).setHeader("Content-Type", "text/html; charset=utf-8").setHeader("Cache-Control", cache).setHeader("Vercel-CDN-Cache-Control", cache).setHeader("CDN-Cache-Control", cache).setHeader("Content-Security-Policy", "frame-ancestors *").setHeader("X-Robots-Tag", "noindex, nofollow").send(html);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const widget = String(req.query.widget ?? "");
  const slug = req.query.slug == null ? [] : ([] as string[]).concat(req.query.slug).filter(Boolean);
  const sp: Record<string, string> = {};
  const q = new URL(req.url ?? "/", "http://x").searchParams;
  q.forEach((v, k) => (sp[k] = v));
  delete sp.widget; delete sp.slug;
  const cfg = parseCfg(sp);
  const dark = cfg.theme === "dark";
  const lang = cfg.lang;
  if (!isWidget(widget) || widget === "gauge" || widget === "forecast" || widget === "card") return res.status(404).send("Not found");
  const needsId = widget === "river" || widget === "town";
  if ((needsId && slug.length !== 1) || (!needsId && slug.length)) return res.status(404).send("Not found");
  const id = slug[0]?.toLowerCase() ?? null;
  let payload = null;
  try {
    payload = await buildEmbed(widget, id, cfg);
  } catch {
    payload = null;
  }
  const st = styleOf(cfg);
  const wrapAttrs = `id="wl" class="${escAttr(st.classes)} ${widget === "ticker" ? "p-1" : "p-1.5"}" lang="${lang}"`;
  const head = `<style>${st.css.replace(/<\/style/gi, "")}</style>${st.fontHref ? `<link rel="stylesheet" href="${escAttr(st.fontHref)}">` : ""}`;
  if (!payload) {
    const msg = needsId || widget === "ticker" ? "This river, gauge or town is not on waterlevels.lk, or the sources are down. Trying again soon." : "Live river levels are not available right now. Trying again soon.";
    return send(res, `<div ${wrapAttrs}>${head}<p class="rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-sm text-slate-600 dark:text-slate-400">${msg}</p></div>`, { lang, dark, widget, status: 503 });
  }
  const html = renderToStaticMarkup(createElement(StaticView, { p: { ...payload, cfg } }));
  send(res, `<div ${wrapAttrs}>${head}${html}</div>`, { lang, dark, widget });
}
