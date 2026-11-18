// node --experimental-strip-types --no-warnings scripts/snapshot-query.test.mts   (retry loop of scripts/snapshot.mjs)
import { queryWithRetry } from "./snapshot-query.mjs";

let bad = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) bad++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
};
const ok = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
// What Node's fetch throws when the connection cannot be made (the 18 Nov 2026 07:30 UTC failure).
const netErr = () => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }) });
const run = async (script: Array<() => unknown>) => {
  let calls = 0;
  const fetchImpl = async () => script[Math.min(calls++, script.length - 1)]();
  try {
    const data = await queryWithRetry("https://example.invalid/q", "gauges_2_view", { fetchImpl, sleep: async () => {} });
    return { calls, data };
  } catch (e) {
    return { calls, error: String((e as Error).message) };
  }
};

eq("first try ok", await run([() => ok({ features: [1] })]), { calls: 1, data: { features: [1] } });
eq("rate-limit body (HTTP 200 with error) is retried", await run([() => ok({ error: { message: "Too many requests." } }), () => ok({ features: [] })]), { calls: 2, data: { features: [] } });
eq("network error once, then ok (the 18 Nov failure)", await run([() => { throw netErr(); }, () => ok({ features: [2] })]), { calls: 2, data: { features: [2] } });
const down = await run([() => { throw netErr(); }]);
eq("network error every time: gives up after 5 attempts", down.calls, 5);
eq("final error names the layer and the cause", /gauges_2_view query failed: .*ETIMEDOUT/.test(String(down.error)), true);
const http = await run([() => ({ ok: false, status: 503, text: async () => "busy" })]);
eq("HTTP 503 every time: 5 attempts", http.calls, 5);

if (bad) {
  console.log(`\n${bad} failed`);
  process.exit(1);
}
console.log("\nall passed");
