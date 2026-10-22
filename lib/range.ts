// Shared range constants. Imported by both the server station page and the
// client RangePicker — keep this file free of "use client" so server
// components can read DEFAULT_DAYS directly without hitting the
// "called a client export from the server" boundary error.

export const DEFAULT_DAYS = 4;

export const ALLOWED_DAYS: readonly number[] = [1, 4, 7] as const;

export function parseDays(value: string | undefined | null): number | null {
  if (!value) return null;
  let n = parseInt(value, 10);
  // gauges_2_view only retains ~7 days; old 14d links clamp to 7.
  if (n === 14) n = 7;
  return ALLOWED_DAYS.includes(n) ? n : null;
}

export const DAYS_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "24h" },
  { value: 4, label: "4d" },
  { value: 7, label: "7d" },
];
