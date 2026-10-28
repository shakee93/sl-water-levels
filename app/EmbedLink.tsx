import Link from "next/link";
import { Code2 } from "lucide-react";
import { embedT } from "@/lib/i18n/embed";
import { localePath, type Locale } from "@/lib/i18n/config";
import type { Widget } from "@/lib/embedConfig";

/** "Embed this on your site": opens the /embed builder with this river, gauge or town already chosen (and the page's language). */
export function EmbedLink({ lang, widget, id }: { lang: Locale; widget: Widget; id: string }) {
  const e = embedT(lang);
  const href = `${localePath(lang, "/embed")}?w=${widget}&id=${encodeURIComponent(id)}#builder`;
  const label = widget === "forecast" ? e("p.buttonForecast") : widget === "card" ? e("p.buttonCard") : e("p.button");
  return (
    <Link href={href} className="mt-6 sm:mt-8 mr-4 inline-flex items-center gap-1.5 min-h-11 text-sm text-slate-500 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300 transition">
      <Code2 className="size-4" aria-hidden />
      {label}
    </Link>
  );
}
