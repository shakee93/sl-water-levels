"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "./LocaleProvider";

// Old links look like /?station=Name[&days=7] (still used by /help). Reading
// searchParams on the server would make the whole home page dynamic, so the
// redirect happens in the browser instead. Renders nothing.
export function LegacyRedirect({ hrefByStation }: { hrefByStation: Record<string, string> }) {
  const router = useRouter();
  const { p } = useI18n();
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const name = q.get("station");
    if (!name) return;
    const href = Object.hasOwn(hrefByStation, name) ? hrefByStation[name] : null;
    if (!href) return;
    const days = q.get("days");
    router.replace(p(days ? `${href}?days=${encodeURIComponent(days)}` : href));
  }, [hrefByStation, router, p]);
  return null;
}
