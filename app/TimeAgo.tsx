"use client";

import { useSyncExternalStore } from "react";
import { formatAge } from "@/lib/i18n/format";
import { useI18n } from "./LocaleProvider";

function subscribe(cb: () => void) {
  const id = setInterval(cb, 30_000);
  return () => clearInterval(id);
}

// Pages are ISR-cached, so a server-rendered "14 min ago" would go stale.
// The server value is used for SSR/hydration, then the browser clock takes over.
// The client snapshot is rounded to 30s so it stays referentially stable.
export function TimeAgo({
  ts,
  serverNow,
  short = false,
}: {
  ts: number;
  serverNow: number;
  short?: boolean;
}) {
  const { t } = useI18n();
  const now = useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / 30_000) * 30_000,
    () => serverNow,
  );
  return <>{formatAge(ts, now, t, short)}</>;
}
