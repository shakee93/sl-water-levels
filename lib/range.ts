// Shared range constants. Imported by both the server station page and the
// client RangePicker — keep this file free of "use client" so server
// components can read DEFAULT_DAYS directly without hitting the
// "called a client export from the server" boundary error.

export const DEFAULT_DAYS = 4;

export const ALLOWED_DAYS: readonly number[] = [1, 4, 7, 14] as const;

export function parseDays(value: string | undefined | null): number | null {
  if (!value) return null;
  const n = parseInt(value, 10);
  return ALLOWED_DAYS.includes(n) ? n : null;
}

export const DAYS_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "24h" },
  { value: 4, label: "4d" },
  { value: 7, label: "7d" },
  { value: 14, label: "14d" },
];
