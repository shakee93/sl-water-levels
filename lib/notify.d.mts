// Types for lib/notify.mjs (plain ESM) so TypeScript callers (app/api/feedback/route.ts) see every option.
export interface NotifyOptions {
  source?: string;
  kind?: string;
  severity?: "info" | "warn" | "error" | "critical" | string;
  meta?: unknown;
  env?: Record<string, string | undefined>;
  doFetch?: typeof fetch;
  now?: number;
  webhook?: string;
  blocks?: unknown[];
  timeoutMs?: number;
  key?: string;
  runUrl?: string | null;
  logTimeoutMs?: number;
}
export const LOG_TIMEOUT_MS: number;
export const MAX_TEXT: number;
export const SCHEMA: string[];
export function scrub(text: unknown, env?: Record<string, string | undefined>): string;
export function classify(text: string): { kind: string; severity: string };
export function normalise(text: string): string;
export function fingerprint(text: string, source?: string, kind?: string, key?: string): string;
export function writeRow(row: Record<string, unknown>, opts?: { env?: Record<string, string | undefined>; timeoutMs?: number }): Promise<boolean>;
export function notify(text: string, options?: NotifyOptions): Promise<{ slackOk: boolean; logged: boolean }>;
export function _reset(): void;
