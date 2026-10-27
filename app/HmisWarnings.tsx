import { AlertTriangle } from "lucide-react";
import { getHmisWarnings, HMIS_CREDIT } from "@/lib/hmis";
import { hmisT } from "@/lib/i18n/hmis";
import type { Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { colomboTime } from "@/app/tierUi";

/**
 * Official warnings published on HMIS (hmis.gov.lk/api/v1/warnings). The list has been empty so far, so this renders nothing then.
 * When it has items they are shown as published, with their source and time. Display only: the text is not interpreted, so it
 * cannot move an official step or a town verdict, and it is not passed to X or push (those read /api/warnings, which is unchanged).
 */
export async function HmisWarnings({ lang }: { lang: Locale }) {
  const w = await getHmisWarnings();
  const items = (w?.items ?? []).filter((i) => i.ts == null || Date.now() - i.ts < 48 * 3_600_000).slice(0, 3);
  if (!items.length) return null;
  const h = hmisT(lang);
  const { t } = getI18n(lang);
  return (
    <section className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100" data-testid="hmis-warnings">
      <h2 className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        {h("warn.h")}
      </h2>
      <ul className="mt-1 space-y-1">
        {items.map((i, k) => (
          <li key={k}>
            <span className="font-medium">{i.title}</span>
            {i.text && i.text !== i.title ? ` – ${i.text}` : ""}
            {i.ts != null ? <span className="text-xs opacity-70">{` (${colomboTime(i.ts, t)})`}</span> : null}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs opacity-70">{HMIS_CREDIT}</p>
    </section>
  );
}
