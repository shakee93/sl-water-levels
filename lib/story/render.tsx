// The one renderer behind every share image: Instagram / WhatsApp / Facebook story (1080x1920), square (1080x1080) and the link-preview
// image the pages use as og:image (1200x630). Same colours, same pill, same chart, so a shared image and a link preview look alike.
import { ImageResponse } from "next/og";
import type { CSSProperties } from "react";
import type { Arrow } from "@/lib/embedTypes";
import type { PillTier } from "@/app/TierPill";
import { embedT } from "@/lib/i18n/embed";
import { getI18n } from "@/lib/i18n/server";
import type { StoryModel, StoryRow, RainStory } from "./model";
import { SIZES, type StoryExt, type StoryFormat } from "./url";
import { STORY_STRINGS } from "./strings";
import { STORY_FAMILY, storyFonts } from "./fonts";
import { ChartSvg, plotChart, TIER_COLOR } from "./chart";

/** Satori does not shape the joiner (U+200D / U+200C) in Sinhala yansaya and rakaransaya, which leaves a stray mark: without it the letters read correctly. */
const z = (v: string) => v.replace(/[\u200c\u200d]/g, "");
const clean = <T,>(v: T): T => (typeof v === "string" ? (z(v) as T) : Array.isArray(v) ? (v.map(clean) as T) : v && typeof v === "object" ? (Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "readings" || k === "forecast" ? x : clean(x)])) as T) : v);

const F: CSSProperties = { display: "flex" };
const COL: CSSProperties = { display: "flex", flexDirection: "column" };
const INK = "#0f172a", MUTED = "#475569", BRAND = "#0369a1";
const ARROW_COLOR: Record<string, string> = { up: "#b45309", down: "#047857", steady: "#475569" };

function ArrowIcon({ a, size }: { a: Arrow; size: number }) {
  if (!a) return null;
  const d = a === "up" ? "M12 19V5M5 12l7-7 7 7" : a === "down" ? "M12 5v14M19 12l-7 7-7-7" : "M5 12h14";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={ARROW_COLOR[a]} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
      <path d={d} />
    </svg>
  );
}

function Pill({ tier, label, size, pad }: { tier: PillTier; label: string; size: number; pad?: number }) {
  const c = TIER_COLOR[tier];
  return <div style={{ ...F, fontSize: size, fontWeight: 800, padding: `${pad ?? size * 0.22}px ${size * 0.7}px`, borderRadius: 999, background: c.bg, color: c.fg, lineHeight: 1.15 }}>{label}</div>;
}

function Drop({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2.5C12 2.5 5 10 5 15a7 7 0 0 0 14 0c0-5-7-12.5-7-12.5z" fill={BRAND} />
    </svg>
  );
}

/** "19.0 ft" -> value and unit, so the unit can be set smaller. */
function Level({ text, size, unit }: { text: string; size: number; unit: number }) {
  const m = /^(.+?)\s+(ft|m)$/.exec(text);
  return (
    <div style={{ ...F, alignItems: "flex-end", color: INK }}>
      <div style={{ ...F, fontSize: size, fontWeight: 800, letterSpacing: -4, lineHeight: 1 }}>{m ? m[1] : text}</div>
      {m && <div style={{ ...F, fontSize: unit, fontWeight: 800, marginLeft: unit * 0.25, marginBottom: size * 0.08, color: MUTED }}>{m[2]}</div>}
    </div>
  );
}

type Dim = { W: number; Hh: number; pad: number; top: number; bottom: number; name: number; sub: number; level: number; unit: number; pill: number; trend: number; next: number; chartH: number; upd: number; brand: number; where: number; rowH: number; rowName: number; rowSub: number; rowLvl: number; rowPill: number; title: number; sum: number; gap: number };
const DIM: Record<"story" | "square" | "portrait", Dim> = {
  story: { W: 1080, Hh: 1920, pad: 64, top: 250, bottom: 250, name: 92, sub: 46, level: 210, unit: 92, pill: 58, trend: 56, next: 46, chartH: 470, upd: 34, brand: 92, where: 32, rowH: 112, rowName: 44, rowSub: 28, rowLvl: 48, rowPill: 28, title: 80, sum: 42, gap: 40 },
  square: { W: 1080, Hh: 1080, pad: 56, top: 44, bottom: 40, name: 62, sub: 32, level: 124, unit: 54, pill: 40, trend: 38, next: 32, chartH: 215, upd: 28, brand: 64, where: 26, rowH: 66, rowName: 33, rowSub: 20, rowLvl: 34, rowPill: 20, title: 58, sum: 32, gap: 26 },
  // 4:5 Instagram feed post: the square sizes with more room; the grid crops it to 3:4 (34 px a side, inside the 56 px padding).
  portrait: { W: 1080, Hh: 1350, pad: 56, top: 70, bottom: 60, name: 66, sub: 34, level: 140, unit: 60, pill: 42, trend: 40, next: 34, chartH: 330, upd: 28, brand: 66, where: 26, rowH: 80, rowName: 36, rowSub: 22, rowLvl: 38, rowPill: 22, title: 62, sum: 34, gap: 32 },
};

function Brand({ lang, size }: { lang: StoryModel["lang"]; size: number }) {
  const t = getI18n(lang).t;
  return (
    <div style={{ ...F, alignItems: "center", fontSize: size, fontWeight: 800, color: BRAND }}>
      <Drop size={size * 1.3} />
      <div style={{ ...F, marginLeft: size * 0.35 }}>{z(t("site.name"))}</div>
    </div>
  );
}

function Footer({ m, d }: { m: StoryModel; d: Dim }) {
  const s = STORY_STRINGS[m.lang];
  return (
    <div style={{ ...COL, alignItems: "center", width: "100%" }}>
      <div style={{ ...F, fontSize: d.brand, fontWeight: 800, color: BRAND, letterSpacing: -1 }}>waterlevels.lk</div>
      {m.where !== "waterlevels.lk" && <div style={{ ...F, fontSize: d.where, fontWeight: 500, color: MUTED, marginTop: 6 }}>{z(`${s.liveAt} ${m.where}`)}</div>}
    </div>
  );
}

function ChartCard({ m, d, w }: { m: StoryModel; d: Dim; w: number }) {
  const c = m.chart!;
  const e = embedT(m.lang);
  const t = getI18n(m.lang).t;
  const s = STORY_STRINGS[m.lang];
  const lab = { alert: z(t("mark.alert")), minor: z(t("mark.minor")), major: z(t("mark.major")) };
  const innerW = w - 2 * 28;
  const plot = plotChart(c, innerW, d.chartH, lab, c.unit === "m" ? 2 : 1);
  if (!plot.has) return null;
  const small = d.upd;
  void e;
  return (
    <div style={{ ...COL, width: w, background: "#ffffff", border: "2px solid #e2e8f0", borderRadius: 36, padding: 28 }}>
      <div style={{ ...F, justifyContent: "space-between", fontSize: small, fontWeight: 500, color: MUTED, marginBottom: 14 }}>
        <div style={F}>{z(s.last24)}</div>
        {plot.fc && <div style={{ ...F, color: "#0284c7", fontWeight: 800 }}>{`${z(s.forecast)} →`}</div>}
      </div>
      <div style={{ ...F, position: "relative", width: innerW, height: d.chartH }}>
        <ChartSvg plot={plot} w={innerW} h={d.chartH} stroke={d.chartH > 400 ? 7 : 6} tier={m.tier} />
        {plot.marks.map((mk) => (
          <div key={mk.key} style={{ ...F, position: "absolute", ...(Math.abs(plot.first - mk.y) >= Math.abs(plot.last - mk.y) ? { left: 0 } : { right: 0 }), top: Math.max(0, mk.y - small - 8), fontSize: small * 0.9, fontWeight: 800, color: mk.key === "alert" ? "#b45309" : mk.key === "minor" ? "#c2410c" : "#b91c1c", background: "rgba(255,255,255,0.85)", padding: "0 6px", borderRadius: 6 }}>
            {mk.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function RowItem({ r, d, last }: { r: StoryRow; d: Dim; last: boolean }) {
  return (
    <div style={{ ...F, alignItems: "center", justifyContent: "space-between", height: d.rowH, borderBottom: last ? "none" : "2px solid #e2e8f0" }}>
      <div style={{ ...COL, flex: 1, marginRight: 16, minWidth: 0 }}>
        <div style={{ ...F, fontSize: d.rowName, fontWeight: 800, color: INK, lineHeight: 1.15, lineClamp: 1 }}>{r.name}</div>
        {r.sub && <div style={{ ...F, fontSize: d.rowSub, fontWeight: 500, color: MUTED }}>{r.sub}</div>}
      </div>
      <div style={{ ...F, alignItems: "center" }}>
        {r.level && <div style={{ ...F, fontSize: d.rowLvl, fontWeight: 800, color: INK, marginRight: 14 }}>{r.level}</div>}
        <ArrowIcon a={r.arrow} size={d.rowLvl} />
        <div style={{ ...F, marginLeft: 12 }}>
          <Pill tier={r.tier} label={r.step} size={d.rowPill} />
        </div>
      </div>
    </div>
  );
}

function Frame({ d, tier, bar, top, children }: { d: Dim; tier: PillTier; bar?: string; /** stack from the top (lists) instead of spreading */ top?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ ...COL, width: d.W, height: d.Hh, background: "linear-gradient(180deg, #e0f2fe 0%, #f8fafc 38%, #ffffff 100%)", color: INK, fontFamily: STORY_FAMILY, position: "relative" }}>
      <div style={{ ...F, height: 22, width: "100%", background: bar ?? TIER_COLOR[tier].bg }} />
      <div style={{ ...COL, flex: 1, padding: `${d.top - 22}px ${d.pad}px ${d.bottom}px`, justifyContent: top ? "flex-start" : "space-between" }}>{children}</div>
    </div>
  );
}

// ---- rain card: the heaviest river areas with bars, and a small map of Sri Lanka coloured by the same rain ----
/** Rain colour ramp (mm in 24 h): pale blue, blue, deep blue, violet for flood-making amounts. */
const RAIN_STOPS: [number, string][] = [[0, "#e0f2fe"], [10, "#7dd3fc"], [25, "#38bdf8"], [50, "#0284c7"], [100, "#1d4ed8"], [150, "#7e22ce"]];
export function rainColor(mm: number): string {
  if (mm < 1) return "#f1f5f9";
  for (let i = RAIN_STOPS.length - 1; i >= 0; i--) if (mm >= RAIN_STOPS[i][0]) return RAIN_STOPS[i][1];
  return RAIN_STOPS[0][1];
}

function RainMapSvg({ map, w, h }: { map: RainStory["map"]; w: number; h: number }) {
  const cw = w / map.nx, ch = h / map.ny;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${map.nx} ${map.ny}`} xmlns="http://www.w3.org/2000/svg">
      <path d={map.coast} fill="#eaf0f6" />
      {map.cells.map(([c, r, mm]) => (
        <rect key={`${c}-${r}`} x={c} y={r} width={1.02} height={1.02} fill={rainColor(mm)} />
      ))}
      <path d={map.coast} fill="none" stroke="#334155" strokeWidth={0.12} strokeLinejoin="round" />
    </svg>
  );
}

function RainLegend({ d }: { d: Dim; compact?: boolean }) {
  const items: [string, string][] = [["10", rainColor(10)], ["25", rainColor(25)], ["50", rainColor(50)], ["100+", rainColor(100)]];
  return (
    <div style={{ ...F, alignItems: "center", fontSize: d.rowSub, fontWeight: 800, color: MUTED }}>
      {items.map(([t, c]) => (
        <div key={t} style={{ ...F, alignItems: "center", marginRight: 10 }}>
          <div style={{ ...F, width: d.rowSub, height: d.rowSub, borderRadius: 6, background: c, marginRight: 6 }} />
          <div style={F}>{t}</div>
        </div>
      ))}
    </div>
  );
}

function RainCard({ m, d }: { m: StoryModel; d: Dim }) {
  const r = m.rain!;
  const s = STORY_STRINGS[m.lang];
  const sq = d.Hh < d.W * 1.5; // square and the 4:5 feed post share the compact sizes
  const innerW = d.W - 2 * d.pad;
  // list left, map right in both formats (the story has more height, so everything is bigger)
  const mapH = sq ? 520 : 760;
  const mapW = Math.round((mapH * r.map.nx) / r.map.ny);
  const listW = innerW - mapW - 24;
  const rowH = sq ? 82 : 122;
  const nameSize = sq ? 30 : 34, mmSize = sq ? 36 : 46;
  const rows = r.rows.slice(0, 6);
  return (
    <Frame d={d} tier="normal" bar={BRAND}>
      <div style={{ ...COL, width: "100%" }}>
        <Brand lang={m.lang} size={d.sub * 0.8} />
        <div style={{ ...F, fontSize: d.title, fontWeight: 800, letterSpacing: -2, lineHeight: 1.05, marginTop: d.gap * 0.5, lineClamp: 2 }}>{m.title}</div>
        {m.subtitle && <div style={{ ...F, fontSize: d.sub, fontWeight: 500, color: MUTED, marginTop: 8 }}>{m.subtitle}</div>}
      </div>

      <div style={{ ...F, width: "100%", alignItems: "flex-start" }}>
        <div style={{ ...COL, width: listW, background: "#ffffff", border: "2px solid #e2e8f0", borderRadius: 36, padding: "4px 28px" }}>
          {rows.length === 0 && <div style={{ ...F, fontSize: nameSize, fontWeight: 800, color: MUTED, padding: "24px 0" }}>—</div>}
          {rows.map((x, i) => (
            <div key={x.name} style={{ ...COL, justifyContent: "center", height: rowH, borderBottom: i === rows.length - 1 ? "none" : "2px solid #e2e8f0" }}>
              <div style={{ ...F, alignItems: "baseline", justifyContent: "space-between" }}>
                <div style={{ ...F, fontSize: nameSize, fontWeight: 800, color: INK, lineClamp: 1, flex: 1, marginRight: 12 }}>{x.name}</div>
                <div style={{ ...F, alignItems: "flex-end", color: INK }}>
                  <div style={{ ...F, fontSize: mmSize, fontWeight: 800, lineHeight: 1 }}>{x.mm}</div>
                  <div style={{ ...F, fontSize: mmSize * 0.5, fontWeight: 800, color: MUTED, marginLeft: 6 }}>{s.mm}</div>
                </div>
              </div>
              <div style={{ ...F, width: "100%", height: sq ? 14 : 20, borderRadius: 10, background: "#f1f5f9", marginTop: 8 }}>
                <div style={{ ...F, width: `${Math.max(6, Math.round(x.frac * 100))}%`, height: "100%", borderRadius: 10, background: rainColor(x.mm) === "#e0f2fe" ? "#7dd3fc" : rainColor(x.mm) }} />
              </div>
            </div>
          ))}
        </div>
        <div style={{ ...COL, alignItems: "center", marginLeft: 24 }}>
          <div style={{ ...F, justifyContent: "center", width: mapW, background: "#ffffff", border: "2px solid #e2e8f0", borderRadius: 36, padding: 6 }}>
            <RainMapSvg map={r.map} w={mapW - 16} h={mapH - 16} />
          </div>
          <div style={{ ...F, marginTop: 10 }}>
            <RainLegend d={d} compact />
          </div>
        </div>
      </div>

      <div style={{ ...COL, width: "100%", marginTop: d.gap * 0.4 }}>
        {r.gauge && (
          <div style={{ ...F, fontSize: d.upd, fontWeight: 800, color: "#075985", background: "#e0f2fe", borderRadius: 24, padding: `${d.upd * 0.3}px ${d.upd * 0.7}px`, alignSelf: "flex-start", marginBottom: d.gap * 0.4 }}>{z(`${s.rainGauge}: ${r.gauge.name}, ${r.gauge.mm} ${s.mm}`)}</div>
        )}
        <div style={{ ...F, fontSize: d.upd, fontWeight: 500, color: MUTED, marginBottom: d.gap * 0.5 }}>{z(`${s.rainSat}${m.updated ? ` · ${m.updated}` : ""}`)}</div>
        <Footer m={m} d={d} />
      </div>
    </Frame>
  );
}

function ResCard({ m, d }: { m: StoryModel; d: Dim }) {
  const r = m.res!;
  const s = STORY_STRINGS[m.lang];
  const sq = d.Hh < d.W * 1.5; // square and the 4:5 feed post share the compact sizes
  const rows = r.rows.slice(0, 6);
  const more = r.more + (r.rows.length - rows.length);
  const rowH = sq ? 84 : 118;
  return (
    <Frame d={d} tier="none" bar={BRAND}>
      <div style={{ ...COL, width: "100%" }}>
        <Brand lang={m.lang} size={d.sub * 0.8} />
        <div style={{ ...F, fontSize: d.title, fontWeight: 800, letterSpacing: -2, lineHeight: 1.05, marginTop: d.gap * 0.5, lineClamp: 2 }}>{m.title}</div>
        {m.summary && <div style={{ ...F, fontSize: d.sum, fontWeight: 500, color: INK, lineHeight: 1.25, marginTop: 10 }}>{m.summary}</div>}
      </div>
      <div style={{ ...COL, width: "100%" }}>
        {rows.length > 0 && (
          <div style={{ ...COL, background: "#ffffff", border: "2px solid #e2e8f0", borderRadius: 36, padding: "4px 30px" }}>
            {rows.map((x, i) => (
              <div key={`${x.name}-${i}`} style={{ ...F, alignItems: "center", justifyContent: "space-between", height: rowH, borderBottom: i === rows.length - 1 ? "none" : "2px solid #e2e8f0" }}>
                <div style={{ ...COL, flex: 1, marginRight: 16, minWidth: 0 }}>
                  <div style={{ ...F, fontSize: sq ? 34 : 46, fontWeight: 800, color: INK, lineHeight: 1.15, lineClamp: 1 }}>{x.name}</div>
                  {x.river && <div style={{ ...F, fontSize: d.rowSub, fontWeight: 500, color: MUTED }}>{x.river}</div>}
                </div>
                <div style={{ ...COL, alignItems: "flex-end" }}>
                  {x.figure && <div style={{ ...F, fontSize: sq ? 34 : 46, fontWeight: 800, color: "#075985" }}>{x.figure}</div>}
                  {x.when && <div style={{ ...F, fontSize: d.rowSub, fontWeight: 500, color: MUTED }}>{x.when}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
        {more > 0 && <div style={{ ...F, fontSize: d.upd, fontWeight: 800, color: MUTED, marginTop: 14 }}>{s.more.replace("{n}", String(more))}</div>}
      </div>
      <div style={{ ...COL, width: "100%", marginTop: d.gap * 0.4 }}>
        <div style={{ ...F, fontSize: d.upd, fontWeight: 500, color: MUTED, marginBottom: d.gap * 0.5 }}>{z(`${s.resSub} · ${Array.from(new Set(r.rows.map((x) => x.source))).join(", ")}`)}</div>
        <Footer m={m} d={d} />
      </div>
    </Frame>
  );
}

function Card({ m, d }: { m: StoryModel; d: Dim }) {
  if (m.rain) return <RainCard m={m} d={d} />;
  if (m.res) return <ResCard m={m} d={d} />;
  const w = d.W - 2 * d.pad;
  const list = m.rows.length > 0 || m.kind === "river" || m.kind === "home";
  const stale = m.level == null && !list;
  return (
    <Frame d={d} tier={m.tier} top={list}>
      <div style={{ ...COL, width: "100%" }}>
        <Brand lang={m.lang} size={d.sub * 0.8} />
        <div style={{ ...F, fontSize: Math.round((list ? d.title : d.name) * (m.title.length > 34 ? 0.62 : m.title.length > 28 ? 0.78 : m.title.length > 23 ? 0.9 : 1)), fontWeight: 800, letterSpacing: -2, lineHeight: 1.05, marginTop: d.gap * 0.5, lineClamp: 2 }}>{m.title}</div>
        {m.subtitle && <div style={{ ...F, fontSize: d.sub, fontWeight: 500, color: MUTED, marginTop: 8 }}>{m.subtitle}</div>}
      </div>

      {list ? (
        // flex: 1 keeps a short list (2-4 gauges) right under the title instead of floating mid-card
        <div style={{ ...COL, width: "100%", marginTop: d.gap * 0.5 }}>
          {m.summary && (
            <div style={{ ...COL, alignItems: "flex-start", marginBottom: d.gap * 0.5 }}>
              <Pill tier={m.tier} label={m.rows.length ? m.step : "✓"} size={d.pill * 0.7} />
              <div style={{ ...F, fontSize: d.sum, fontWeight: 500, color: INK, lineHeight: 1.25, marginTop: 10 }}>{m.summary}</div>
            </div>
          )}
          {m.rows.length > 0 && (
            <div style={{ ...COL, background: "#ffffff", border: "2px solid #e2e8f0", borderRadius: 36, padding: "6px 30px" }}>
              {m.rows.map((r, i) => (
                <RowItem key={`${r.name}-${i}`} r={r} d={d} last={i === m.rows.length - 1} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ ...COL, width: "100%" }}>
          {m.level ? <Level text={m.level} size={d.level} unit={d.unit} /> : <div style={{ ...F, fontSize: d.next * 1.3, fontWeight: 800, color: MUTED }}>{m.summary ?? "—"}</div>}
          <div style={{ ...F, alignItems: "center", marginTop: d.gap * 0.7 }}>
            <Pill tier={m.tier} label={m.step} size={d.pill} />
            {m.trend && !stale && (
              <div style={{ ...F, alignItems: "center", marginLeft: 28, fontSize: d.trend, fontWeight: 800, color: ARROW_COLOR[m.arrow ?? "steady"] }}>
                <ArrowIcon a={m.arrow} size={d.trend * 1.1} />
                <div style={{ ...F, marginLeft: 8 }}>{m.trend}</div>
              </div>
            )}
          </div>
          {m.next && (
            <div style={{ ...F, alignItems: "center", fontSize: d.next, fontWeight: 800, color: "#075985", background: "#e0f2fe", borderRadius: 24, padding: `${d.next * 0.35}px ${d.next * 0.7}px`, marginTop: d.gap * 0.8, alignSelf: "flex-start" }}>
              <ArrowIcon a={m.nextArrow} size={d.next * 1.1} />
              <div style={{ ...F, marginLeft: 10 }}>{m.next}</div>
            </div>
          )}
        </div>
      )}

      <div style={{ ...COL, width: "100%", marginTop: list ? "auto" : d.gap * 0.6 }}>
        {!list && m.chart && <ChartCard m={m} d={d} w={w} />}
        {m.updated && <div style={{ ...F, fontSize: d.upd, fontWeight: 500, color: MUTED, marginTop: d.gap * 0.5, marginBottom: d.gap * 0.7 }}>{m.updated}</div>}
        <Footer m={m} d={d} />
      </div>
    </Frame>
  );
}

// ---- link preview (1200x630): name, level and step on the left, the chart or the worst gauges on the right ----
function Og({ m }: { m: StoryModel }) {
  const W = 1200, Hh = 630;
  const list = m.rows.length > 0 || m.kind === "river" || m.kind === "home";
  const d: Dim = { ...DIM.square, W, Hh, rowH: 64, rowName: 28, rowSub: 20, rowLvl: 28, rowPill: 20, chartH: 300, upd: 24 };
  const rightW = 560;
  return (
    <div style={{ ...COL, width: W, height: Hh, background: "linear-gradient(135deg, #e0f2fe 0%, #f8fafc 45%, #ffffff 100%)", fontFamily: STORY_FAMILY, color: INK }}>
      <div style={{ ...F, height: 16, width: "100%", background: TIER_COLOR[m.tier].bg }} />
      <div style={{ ...F, flex: 1, padding: "28px 52px 0" }}>
        <div style={{ ...COL, width: 500, justifyContent: "space-between" }}>
          <div style={COL}>
            <Brand lang={m.lang} size={22} />
            <div style={{ ...F, fontSize: m.title.length > 22 ? 52 : 64, fontWeight: 800, letterSpacing: -2, lineHeight: 1.05, marginTop: 14, lineClamp: 2 }}>{m.title}</div>
            {m.subtitle && <div style={{ ...F, fontSize: 28, fontWeight: 500, color: MUTED, marginTop: 6 }}>{m.subtitle}</div>}
          </div>
          <div style={COL}>
            {!list && (m.level ? <Level text={m.level} size={120} unit={52} /> : null)}
            <div style={{ ...F, alignItems: "center", marginTop: 14 }}>
              <Pill tier={m.tier} label={m.rows.length ? m.step : m.step} size={34} />
              {m.trend && !list && (
                <div style={{ ...F, alignItems: "center", marginLeft: 20, fontSize: 32, fontWeight: 800, color: ARROW_COLOR[m.arrow ?? "steady"] }}>
                  <ArrowIcon a={m.arrow} size={36} />
                  <div style={{ ...F, marginLeft: 6 }}>{m.trend}</div>
                </div>
              )}
            </div>
            {list && m.summary && <div style={{ ...F, fontSize: 28, fontWeight: 500, color: INK, marginTop: 12, lineHeight: 1.25 }}>{m.summary}</div>}
            {!list && m.next && <div style={{ ...F, fontSize: 28, fontWeight: 800, color: "#075985", marginTop: 12 }}>{m.next}</div>}
          </div>
        </div>
        <div style={{ ...COL, flex: 1, marginLeft: 32, justifyContent: "center" }}>
          {!list && m.chart ? <ChartCard m={m} d={d} w={rightW + 40} /> : null}
          {list && m.rows.length > 0 && (
            <div style={{ ...COL, background: "#ffffff", border: "2px solid #e2e8f0", borderRadius: 28, padding: "4px 22px", width: rightW + 40 }}>
              {m.rows.slice(0, 5).map((r, i, a) => (
                <RowItem key={`${r.name}-${i}`} r={r} d={d} last={i === a.length - 1} />
              ))}
            </div>
          )}
        </div>
      </div>
      <div style={{ ...F, justifyContent: "space-between", alignItems: "center", padding: "0 52px 24px" }}>
        <div style={{ ...F, fontSize: 40, fontWeight: 800, color: BRAND }}>waterlevels.lk</div>
        {m.updated && <div style={{ ...F, fontSize: 24, fontWeight: 500, color: MUTED }}>{m.updated}</div>}
      </div>
    </div>
  );
}

const CACHE = "public, s-maxage=300, stale-while-revalidate=600";

export async function renderStory(model: StoryModel, format: StoryFormat, ext: StoryExt = "png"): Promise<Response> {
  const m = clean(model);
  const size = SIZES[format];
  const fonts = await storyFonts(m.lang);
  const img = new ImageResponse(m.rain || m.res ? (format === "og" ? <Card m={m} d={{ ...DIM.square }} /> : <Card m={m} d={DIM[format]} />) : format === "og" ? <Og m={m} /> : <Card m={m} d={DIM[format]} />, { ...size, fonts, headers: { "Cache-Control": CACHE, "CDN-Cache-Control": CACHE, "Vercel-CDN-Cache-Control": CACHE } });
  return ext === "jpg" ? toJpeg(img) : img;
}

/**
 * Instagram accepts JPEG only. The same picture, flattened on white (no transparency) and re-encoded with sharp; same cache headers.
 * Quality 90 keeps small text crisp and stays well under Instagram's 8 MB limit (a story picture is about 250 KB).
 */
export async function toJpeg(png: Response): Promise<Response> {
  const sharp = (await import("sharp")).default;
  const out = await sharp(Buffer.from(await png.arrayBuffer())).flatten({ background: "#ffffff" }).jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
  const headers = new Headers({ "Content-Type": "image/jpeg", "Cache-Control": CACHE, "CDN-Cache-Control": CACHE, "Vercel-CDN-Cache-Control": CACHE });
  return new Response(new Uint8Array(out), { headers });
}

/** A plain card when the sources cannot be read, so a shared link never gets a broken image. Short cache so it recovers quickly. */
export async function renderFallback(format: StoryFormat, title: string): Promise<Response> {
  const size = SIZES[format];
  const fonts = await storyFonts("en");
  const C = "public, s-maxage=60";
  return new ImageResponse(
    (
      <div style={{ ...COL, width: size.width, height: size.height, alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)", color: "#fff", fontFamily: STORY_FAMILY }}>
        <div style={{ ...F, fontSize: format === "og" ? 64 : 84, fontWeight: 800, textAlign: "center", padding: 60 }}>{title}</div>
        <div style={{ ...F, fontSize: format === "og" ? 36 : 56, fontWeight: 500, marginTop: 20 }}>waterlevels.lk</div>
      </div>
    ),
    { ...size, fonts, headers: { "Cache-Control": C, "CDN-Cache-Control": C, "Vercel-CDN-Cache-Control": C } },
  );
}
