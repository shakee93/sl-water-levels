"use client";

import { useSyncExternalStore } from "react";
import { formatAge, formatAgeShort } from "./tierUi";

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
  const now = useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / 30_000) * 30_000,
    () => serverNow,
  );
  return <>{short ? formatAgeShort(ts, now) : formatAge(ts, now)}</>;
}
