// Publisher styling for the embed widgets: validated settings in (lib/embedConfig.ts), safe CSS out. Pure; used by the widget (server and
// browser) and by the builder (for its contrast warnings). Only whitelisted keys and 6-digit hex colours ever reach the CSS text, so no URL,
// raw CSS or script can be injected. The official step colours (Normal / Alert / Minor flood / Major flood) are not styleable: they keep the
// same meaning on every site. The credit line is not styleable away: fixed 11 px, and its colour always keeps 4.5:1 against a known background.
import type { EmbedCfg, EmbedFont } from "./embedConfig";

const WHITE = "ffffff";
const DARK_CARD = "0f172a"; // the dark card colour (slate-900)

const rgb = (h: string): [number, number, number] => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
const toHex = (c: number[]) => c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
function lum(h: string): number {
  const [r, g, b] = rgb(h).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio of two 6-digit hex colours. */
export function contrast(a: string, b: string): number {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const mix = (a: string, b: string, t: number) => toHex(rgb(a).map((v, i) => v * (1 - t) + rgb(b)[i] * t)); // t = share of b

/** `fg` unchanged when it reads at 4.5:1 on `bg`, else moved toward black or white (whichever reads better) until it does. */
export function readable(fg: string, bg: string, min = 4.5): { color: string; changed: boolean } {
  if (contrast(fg, bg) >= min) return { color: fg, changed: false };
  const target = contrast("000000", bg) >= contrast("ffffff", bg) ? "000000" : "ffffff";
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const c = mix(fg, target, t);
    if (contrast(c, bg) >= min) return { color: c, changed: true };
  }
  return { color: target, changed: true };
}

export const FONT_STACK: Record<EmbedFont, string | null> = {
  system: null,
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, Cambria, "Times New Roman", Times, serif',
  "noto-sans": '"Noto Sans", sans-serif',
  "noto-serif": '"Noto Serif", serif',
  inter: '"Inter", sans-serif',
  roboto: '"Roboto", sans-serif',
  merriweather: '"Merriweather", serif',
};
const GF: Partial<Record<EmbedFont, string>> = {
  "noto-sans": "Noto+Sans:wght@400;500;600;700",
  "noto-serif": "Noto+Serif:wght@400;500;600;700",
  inter: "Inter:wght@400;500;600;700",
  roboto: "Roboto:wght@400;500;700",
  merriweather: "Merriweather:wght@400;700",
};
export const FONT_LABEL: Record<EmbedFont, string> = { system: "System (default)", sans: "Sans-serif", serif: "Serif", "noto-sans": "Noto Sans", "noto-serif": "Noto Serif", inter: "Inter", roboto: "Roboto", merriweather: "Merriweather" };

export type StyleOut = {
  css: string;
  /** classes for the widget's wrapper */
  classes: string;
  /** Google Fonts stylesheet, only when a Google font is chosen */
  fontHref: string | null;
  /** what the contrast check changed, for the builder's warning */
  fixed: { text: boolean; accent: boolean };
  /** the text colour the widget really uses (after any correction), or null = default */
  textUsed: string | null;
  accentUsed: string | null;
};

type StyleIn = Pick<EmbedCfg, "theme" | "accent" | "bg" | "text" | "font" | "scale" | "radius" | "border" | "shadow" | "pad" | "title">;

export function styleOf(c: StyleIn): StyleOut {
  const cls = ["emb"];
  const vars: string[] = [];
  const rules: string[] = [];
  let fixedText = false, fixedAccent = false;
  const customColour = !!(c.bg || c.text);

  // The card background the colours are checked against: the publisher's, else the theme's. A custom text colour needs a known background,
  // so with theme "auto" (which could be dark) the card is made white.
  let bg: string | null = c.bg === "transparent" ? null : c.bg;
  if (!c.bg && customColour) bg = c.theme === "dark" ? DARK_CARD : WHITE;
  if (bg && !c.bg) cls.push("emb-bg"), vars.push(`--e-bg:#${bg}`);
  if (c.bg === "transparent") cls.push("emb-bg"), vars.push("--e-bg:transparent");
  else if (c.bg) cls.push("emb-bg"), vars.push(`--e-bg:#${c.bg}`);

  // text
  const defaultText = c.theme === "dark" ? "e2e8f0" : "0f172a";
  let text: string | null = c.text;
  if (customColour) {
    text = c.text ?? (bg ? readable(defaultText, bg).color : defaultText);
    if (c.text && bg) {
      const r = readable(c.text, bg);
      text = r.color;
      fixedText = r.changed;
    }
    cls.push("emb-c");
    vars.push(`--e-text:#${text}`);
    if (bg) {
      const muted = readable(mix(text, bg, 0.22), bg).color; // a quieter shade of the text that still reads
      vars.push(`--e-muted:#${muted}`, `--e-line:#${mix(bg, text, 0.2)}`);
    } else {
      // transparent card: the page behind is unknown, so quieter text is the same colour a little see-through
      vars.push(`--e-muted:color-mix(in srgb, #${text} 82%, transparent)`, `--e-line:color-mix(in srgb, #${text} 22%, transparent)`);
    }
  }

  // accent: lines, band, dots and focus rings use it as given; links (text) use a version that reads on the background
  let accentUsed: string | null = null;
  if (c.accent) {
    vars.push(`--e-accent:#${c.accent}`);
    let link = c.accent;
    const against = bg ?? (c.bg === "transparent" ? null : c.theme === "dark" ? DARK_CARD : WHITE);
    if (against) {
      const r = readable(c.accent, against);
      link = r.color;
      fixedAccent = r.changed;
    }
    vars.push(`--e-link:#${link}`);
    accentUsed = c.accent;
  }

  if (c.radius !== 12) vars.push(`--e-radius:${c.radius}px`);
  const stack = FONT_STACK[c.font];
  if (stack) vars.push(`--e-font:${stack}, var(--font-sinhala), var(--font-tamil)`);
  if (!c.border) cls.push("emb-nobd");
  if (!c.shadow) cls.push("emb-nosh");
  if (c.pad === "tight") cls.push("emb-tight");
  if (!c.title) cls.push("emb-notitle");

  rules.push(
    "html,body{background:transparent}",
    c.scale !== 100 ? `html{font-size:${c.scale}%}` : "",
    `.emb{${vars.join(";")}}`,
    stack ? ".emb{font-family:var(--e-font)}" : "",
    ".emb-link{color:var(--e-link,#0369a1)}.dark .emb-link{color:var(--e-link,#7dd3fc)}",
    ".emb a:focus-visible{outline:2px solid var(--e-accent,#0ea5e9);outline-offset:2px;border-radius:2px}",
    ".emb .emb-card{border-radius:var(--e-radius,.75rem)}",
    ".emb.emb-nobd .emb-card{border-width:0}",
    ".emb.emb-nosh .emb-card{box-shadow:none}",
    ".emb.emb-tight .emb-card{padding:.5rem}",
    ".emb.emb-bg .emb-card{background:var(--e-bg)}",
    ".emb.emb-notitle .emb-title{display:none}",
    ".emb.emb-c{color:var(--e-text)}",
    '.emb.emb-c [class*="text-slate-"]:not(.tier-pill){color:var(--e-muted)}',
    '.emb.emb-c svg.lucide[class*="text-"]:not([class*="text-sky"]){color:currentColor}',
    '.emb.emb-c [class*="border-slate-"],.emb.emb-c .emb-card{border-color:var(--e-line)}',
    '.emb.emb-c [class*="divide-slate-"]>*{border-color:var(--e-line)}',
    ".emb.emb-c .emb-tile{background:color-mix(in srgb,var(--e-text) 6%,transparent);border-color:var(--e-line)}",
    ".emb.emb-c .emb-chip{background:transparent}",
  );
  // the tone border of an Alert / Minor / Major card keeps its colour on a custom background (the card tint is replaced by the publisher's colour)
  rules.push(".emb.emb-c .emb-card.emb-tone{border-color:var(--e-tone)}");

  const fam = GF[c.font];
  return {
    css: rules.filter(Boolean).join("\n"),
    classes: cls.join(" "),
    fontHref: fam ? `https://fonts.googleapis.com/css2?family=${fam}&display=swap` : null,
    fixed: { text: fixedText, accent: fixedAccent },
    textUsed: customColour ? text : null,
    accentUsed,
  };
}
