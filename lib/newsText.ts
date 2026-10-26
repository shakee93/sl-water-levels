// Pure text helpers for news items (no imports, so scripts/news.test.mts runs them under plain node).

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** Tags out, entities decoded, whitespace collapsed. */
export function plainText(html: string): string {
  return decodeEntities(html.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------- snippet (copyright limit)

export const SNIPPET_MAX_WORDS = 20;

/**
 * At most one short snippet of the publisher's own feed description: the first sentence, cut at 20 words.
 * Never the full article. Null when the description is empty or only repeats the headline.
 */
export function snippetOf(desc: string, title = ""): string | null {
  let s = desc
    .replace(/\s*(?:\[?…\]?|\.\.\.)?\s*Continue Reading\b.*$/i, "")
    .replace(/\s*The post\b.*?\bappeared first on\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  const cut = /^(.+?[.!?])(?=\s+[A-Z“"'‘]|$)/.exec(s);
  const sentenceEnded = !!cut;
  if (cut) s = cut[1];
  const words = s.split(" ");
  let out = s;
  let clipped = !sentenceEnded; // the feed's excerpt stops mid-sentence
  if (words.length > SNIPPET_MAX_WORDS) {
    out = words.slice(0, SNIPPET_MAX_WORDS).join(" ");
    clipped = true;
  }
  out = out.replace(/[\s,;:–—-]+$/, "");
  if (clipped) out = out.replace(/[.!?…]+$/, "") + "…";
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const nt = norm(title);
  const no = norm(out);
  if (!no || (nt && (no === nt || nt.startsWith(no) || no.startsWith(nt)))) return null;
  return out;
}

