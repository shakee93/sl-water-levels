// Fonts for the story images: Noto Sans (Latin) always, plus Noto Sans Sinhala / Tamil for those pages. WOFF files kept in this folder
// (Google Fonts, OFL), read once per server instance. next.config.ts lists the folder in outputFileTracingIncludes.
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Locale } from "@/lib/i18n/config";

type F = { name: string; data: Buffer; weight: 500 | 800; style: "normal" };
const cache = new Map<string, Promise<F[]>>();

async function load(file: string, name: string): Promise<F[]> {
  const dir = path.join(process.cwd(), "lib", "story", "fonts");
  return Promise.all(([500, 800] as const).map(async (weight) => ({ name, data: await readFile(path.join(dir, `${file}-${weight}.woff`)), weight, style: "normal" as const })));
}

/** Fonts are matched by family name: the page's text lists them all (fontFamily), so each glyph comes from the first font that has it. */
export const STORY_FAMILY = "Noto, NotoSi, NotoTa";

export function storyFonts(lang: Locale): Promise<F[]> {
  let p = cache.get(lang);
  if (!p) {
    p = Promise.all([load("en", "Noto"), ...(lang === "si" ? [load("si", "NotoSi")] : lang === "ta" ? [load("ta", "NotoTa")] : [])]).then((x) => x.flat());
    p.catch(() => cache.delete(lang));
    cache.set(lang, p);
  }
  return p;
}
