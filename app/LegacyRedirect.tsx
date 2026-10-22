"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Old links look like /?station=Name[&days=7] (still used by /help). Reading
// searchParams on the server would make the whole home page dynamic, so the
// redirect happens in the browser instead. Renders nothing.
export function LegacyRedirect({ hrefByStation }: { hrefByStation: Record<string, string> }) {
  const router = useRouter();
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const name = p.get("station");
    if (!name) return;
    const href = Object.hasOwn(hrefByStation, name) ? hrefByStation[name] : null;
    if (!href) return;
    const days = p.get("days");
    router.replace(days ? `${href}?days=${encodeURIComponent(days)}` : href);
  }, [hrefByStation, router]);
  return null;
}
