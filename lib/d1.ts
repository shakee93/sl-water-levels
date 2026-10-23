// Minimal Cloudflare D1 client over the HTTP API, for the few server routes that write to the "sl-water-levels"
// database (the prediction log's database, see d1/*.sql). The site runs on Vercel and has no D1 binding, so it
// needs ONE secret: CLOUDFLARE_API_TOKEN in the Vercel project's environment variables (a token with
// "D1: Edit" on this account; a separate D1-only token is safer than reusing the broad one). Fails soft: when the
// token is missing every call throws D1NotConfigured and the caller shows a calm "try again later".
// CF_API_BASE exists only so local tests can point at a fake server.

const ACCOUNT_ID = "83e812aa5ee674fe01ce3a9eb1e04cbe"; // same as the workflows; an identifier, not a secret
const DB_NAME = "sl-water-levels";

export class D1NotConfigured extends Error {
  constructor() {
    super("CLOUDFLARE_API_TOKEN is not set");
  }
}

const base = () => process.env.CF_API_BASE || "https://api.cloudflare.com/client/v4";
export const d1Configured = () => !!process.env.CLOUDFLARE_API_TOKEN;

let dbId: string | undefined = process.env.CF_D1_DATABASE_ID || undefined;

async function cf(path: string, init?: RequestInit): Promise<{ result?: unknown; success?: boolean; errors?: { message?: string }[] }> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new D1NotConfigured();
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as { result?: unknown; success?: boolean; errors?: { message?: string }[] };
  if (!res.ok || j.success === false) throw new Error(`D1 HTTP ${res.status}: ${(j.errors ?? []).map((e) => e.message).join("; ").slice(0, 200)}`);
  return j;
}

async function databaseId(): Promise<string> {
  if (dbId) return dbId;
  const j = await cf(`/accounts/${ACCOUNT_ID}/d1/database?name=${DB_NAME}`);
  const hit = (j.result as { uuid: string; name: string }[] | undefined)?.find((d) => d.name === DB_NAME);
  if (!hit) throw new Error(`D1 database ${DB_NAME} not found`);
  dbId = hit.uuid;
  return dbId;
}

export type D1Row = Record<string, string | number | null>;

/** Runs one statement with bound parameters and returns its rows. */
export async function d1Query(sql: string, params: (string | number | null)[] = []): Promise<D1Row[]> {
  const id = await databaseId();
  const j = await cf(`/accounts/${ACCOUNT_ID}/d1/database/${id}/query`, { method: "POST", body: JSON.stringify({ sql, params }) });
  const first = (j.result as { results?: D1Row[] }[] | undefined)?.[0];
  return first?.results ?? [];
}
