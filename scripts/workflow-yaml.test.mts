// Every workflow file must be YAML that GitHub can load. On 12 Nov 2026 a step name with a colon and a space inside an unquoted
// value ("... last and isolated: it cannot fail this job") made forecast-scoreboard.yml invalid: GitHub refused the file, the
// nightly archive + KPI job could not be started at all, and nothing alerted (a job that never starts has no failed run).
// No npm package here (the Tests workflow has no node_modules): a line check for that exact mistake, plus a full parse with
// js-yaml when it happens to be installed.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

/** Lines whose unquoted one-line value holds ": " or ends with ":" (YAML then reads a second mapping key and fails). */
export function badPlainScalars(text: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let block = -1; // indent of the key that opened a block scalar (| or >); deeper lines are free text
  text.split("\n").forEach((raw, i) => {
    if (!raw.trim()) return;
    const indent = raw.length - raw.trimStart().length;
    if (block >= 0) { if (indent > block) return; block = -1; }
    const m = /^(\s*)(?:- )?([A-Za-z_][\w.-]*):(?: (.*))?$/.exec(raw);
    if (!m) return;
    const v = (m[3] ?? "").trim();
    if (/^[|>][+-]?\d*(\s+#.*)?$/.test(v)) { block = indent; return; }
    if (!v || /^["'\[{&*!#]/.test(v)) return;
    const bare = v.replace(/\s+#.*$/, "");
    if (/: /.test(bare) || /:$/.test(bare)) out.push({ line: i + 1, text: raw.trim() });
  });
  return out;
}

// the mistake itself, and its quoted form
const broken = "jobs:\n  a:\n    steps:\n      - name: Report (last and isolated: it cannot fail this job)\n        run: |\n          echo \"a: b\"\n";
assert.equal(badPlainScalars(broken).length, 1, "the unquoted name with a colon is caught");
assert.equal(badPlainScalars(broken)[0].line, 4);
assert.equal(badPlainScalars(broken.replace("name: Report (last and isolated: it cannot fail this job)", 'name: "Report (last and isolated: it cannot fail this job)"')).length, 0, "quoted is fine");
assert.equal(badPlainScalars("on:\n  schedule:\n    - cron: '5 * * * *'\nenv:\n  A: ${{ vars.A }} # note: a comment\n  B: http://x.test/a\n").length, 0, "comments, URLs and expressions are fine");

const dir = new URL("../.github/workflows/", import.meta.url);
const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
assert.ok(files.length > 5, "workflow files found");
let yaml: { load: (s: string) => unknown } | null = null;
try { yaml = (await import("js-yaml" as string)).default; } catch { /* not installed in CI: the line check stands alone */ }
for (const f of files) {
  const text = readFileSync(new URL(f, dir), "utf8");
  const bad = badPlainScalars(text);
  assert.deepEqual(bad, [], `${f}: quote this value, a colon inside it breaks the file: ${JSON.stringify(bad)}`);
  if (yaml) assert.doesNotThrow(() => yaml!.load(text), `${f} does not parse`);
}
console.log(`ok workflow-yaml (${files.length} files${yaml ? ", full parse" : ""})`);
