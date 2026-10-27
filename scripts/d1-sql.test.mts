// @ts-nocheck (node strip-types test)
// node --experimental-strip-types --no-warnings scripts/d1-sql.test.mts
// The D1 HTTP runner (lib/d1Sql.mjs) and the read-retry rule (lib/d1.ts), against a fake Cloudflare API.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { splitSql, chunkStatements } from "../lib/d1Sql.mjs";

// splitting: strings with ; and newlines, '' escapes, comments, multi-line statements
const sql = readFileSync(new URL("../d1/0002_curw.sql", import.meta.url), "utf8");
const parts = splitSql(sql);
assert.ok(parts.length >= 8 && parts.every((p) => !p.includes("--") || p.includes("'")), "schema file splits into statements, comments dropped");
assert.deepEqual(splitSql("INSERT INTO t VALUES ('a;b', 'it''s'); -- note; here\n/* x; */ DELETE FROM t WHERE a = 1;\n"), ["INSERT INTO t VALUES ('a;b', 'it''s')", "DELETE FROM t WHERE a = 1"]);
for (const f of ["0003_street_flood", "0005_street_shadow", "0009_forecast_rain"]) assert.ok(splitSql(readFileSync(new URL(`../d1/${f}.sql`, import.meta.url), "utf8")).length > 0);

// chunking: <= 50 statements and <= 100 KB, a 48 KB chunk statement never grouped past the byte limit, order kept
const many = Array.from({ length: 120 }, (_, i) => `SELECT ${i}`);
assert.deepEqual(chunkStatements(many).map((c) => c.length), [50, 50, 20]);
const big = ["x".repeat(48_000), "y".repeat(48_000), "z".repeat(48_000), "SELECT 1"];
const bc = chunkStatements(big);
assert.deepEqual(bc.map((c) => c.length), [2, 2]);
assert.deepEqual(bc.flat(), big);

// fake Cloudflare: first batch times out (HTTP 500 + 7429), then works; list databases; GET read fails twice then succeeds
const calls = [];
let failBatch = 1, failRead = 2;
const srv = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d)).on("end", () => {
    const j = body ? JSON.parse(body) : {};
    calls.push({ url: req.url, j });
    const send = (code, o) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.url.includes("/d1/database?name=")) return send(200, { success: true, result: [{ uuid: "db1", name: "sl-water-levels" }] });
    if (j.batch && failBatch-- > 0) return send(500, { success: false, errors: [{ code: 7429, message: "D1 DB storage operation exceeded timeout which caused object to be reset." }] });
    if (j.sql && /^SELECT 1/.test(j.sql) && failRead-- > 0) return send(500, { success: false, errors: [{ code: 7429, message: "storage operation exceeded timeout" }] });
    if (j.sql && /bad/.test(j.sql)) return send(400, { success: false, errors: [{ code: 7500, message: "no such table: bad" }] });
    send(200, { success: true, result: [{ results: [{ x: 1 }] }] });
  });
});
await new Promise((r) => srv.listen(0, r));
process.env.CF_API_BASE = `http://127.0.0.1:${srv.address().port}`;
process.env.CLOUDFLARE_API_TOKEN = "test-token";
const { runStatements, selectRows, D1HttpError } = await import("../lib/d1Sql.mjs?fake");
const started = Date.now();
const r = await runStatements(["INSERT OR IGNORE INTO a VALUES (1)", "DELETE FROM a WHERE rowid IN (SELECT rowid FROM a LIMIT 5)"], { label: "t" });
assert.equal(r.statements, 2);
assert.equal(calls.filter((c) => c.j.batch).length, 2, "the timed-out batch was sent again, once");
assert.ok(Date.now() - started >= 1900, "backed off before the retry");
assert.equal((await selectRows("SELECT 1")).length, 1);
// a real SQL error is not retried and is not transient
await assert.rejects(() => runStatements(["SELECT * FROM bad"]), (e) => e instanceof D1HttpError && !e.transient && /no such table/.test(e.message));
srv.close();

// lib/d1.ts: reads retry twice then succeed; idempotent CREATE retries; plain writes do not and are not "read blips"
const srv2 = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d)).on("end", () => {
    const j = body ? JSON.parse(body) : {};
    const send = (code, o) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.url.includes("/d1/database?name=")) return send(200, { success: true, result: [{ uuid: "db1", name: "sl-water-levels" }] });
    attempts[j.sql] = (attempts[j.sql] ?? 0) + 1;
    if (attempts[j.sql] <= (failFor[j.sql] ?? 0)) return send(500, { success: false, errors: [{ code: 7429, message: "storage operation exceeded timeout" }] });
    send(200, { success: true, result: [{ results: [{ ok: 1 }] }] });
  });
});
const attempts = {}, failFor = { "SELECT 2": 2, "SELECT 3": 3, "CREATE TABLE IF NOT EXISTS z (a)": 1, "INSERT INTO z VALUES (1)": 1 };
await new Promise((r) => srv2.listen(0, r));
process.env.CF_API_BASE = `http://127.0.0.1:${srv2.address().port}`;
const { d1Query, isD1ReadBlip } = await import("../lib/d1.ts");
assert.deepEqual(await d1Query("SELECT 2"), [{ ok: 1 }]);
assert.equal(attempts["SELECT 2"], 3);
await assert.rejects(() => d1Query("SELECT 3"), (e) => isD1ReadBlip(e), "a read that keeps timing out is a blip: the job skips the run");
assert.equal(attempts["SELECT 3"], 3);
await d1Query("CREATE TABLE IF NOT EXISTS z (a)");
assert.equal(attempts["CREATE TABLE IF NOT EXISTS z (a)"], 2);
await assert.rejects(() => d1Query("INSERT INTO z VALUES (1)"), (e) => !isD1ReadBlip(e));
assert.equal(attempts["INSERT INTO z VALUES (1)"], 1, "a plain write is never retried");
srv2.close();
console.log("d1-sql tests passed");
