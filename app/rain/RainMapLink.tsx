import Link from "next/link";
import { CloudRain } from "lucide-react";
import { localePath, type Locale } from "@/lib/i18n/config";
import { rmFor } from "@/lib/i18n/rainMap";

/** "Rain map" link to /rain, for the home map, river pages and town pages. */
export function RainMapLink({ lang, className = "" }: { lang: Locale; className?: string }) {
  return (
    <Link
      href={localePath(lang, "/rain")}
      className={`inline-flex items-center gap-1.5 text-sm font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-300 ${className}`}
    >
      <CloudRain className="size-4" aria-hidden />
      {rmFor(lang)("link")}
    </Link>
  );
}
