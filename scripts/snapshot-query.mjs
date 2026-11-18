// ArcGIS query with retry for scripts/snapshot.mjs (kept apart so it can be tested without running the snapshot).
//
// ArcGIS rate-limits bursts (>=1 req/s returns HTTP 200 with "Too many requests."), so
// requests are spaced out and retried with backoff: at most 5 attempts, 2 s x attempt between them.
// A network error (fetch throws: connect ETIMEDOUT, reset) counts as a failed attempt too: on 18 Nov 2026
// one connect timeout to ArcGIS at 07:30 UTC failed the whole Daily data snapshot on its first request.
export async function queryWithRetry(url, label, { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), attempts = 5 } = {}) {
  for (let attempt = 1; ; attempt++) {
    let status, data;
    try {
      const r = await fetchImpl(url);
      const text = await r.text();
      status = r.status;
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: { message: text.slice(0, 200) } };
      }
      if (r.ok && !data.error) return data;
    } catch (e) {
      status = "network";
      data = { error: { message: `${e?.message ?? e}${e?.cause?.code ? ` (${e.cause.code})` : ""}` } };
    }
    if (attempt >= attempts) throw new Error(`${label} query failed: ${status} ${JSON.stringify(data.error)}`);
    await sleep(2000 * attempt);
  }
}
