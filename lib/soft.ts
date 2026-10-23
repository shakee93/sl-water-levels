// Time-boxing for slow, non-essential upstreams (OpenAI, PUCSL, news feeds).
//
// `soft(p, ms, fallback)` resolves with the fallback if `p` has not settled within `ms`, so a slow
// source can never hold up the page. `p` is NOT cancelled: it keeps running (and, through
// unstable_cache, keeps filling the data cache) and is handed to `after()` so the serverless
// function stays alive until it finishes. The next render then finds the cached result.
// A rejection of `p` also resolves to the fallback (callers here all fail soft).
import { after } from "next/server";

export function soft<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  const settled = p.then(
    (v) => ({ ok: true as const, v }),
    () => ({ ok: false as const }),
  );
  try {
    after(() => settled.then(() => undefined));
  } catch {
    // outside a request (scripts, tests): nothing to keep alive
  }
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    void settled.then((r) => {
      clearTimeout(timer);
      resolve(r.ok ? r.v : fallback);
    });
  });
}
