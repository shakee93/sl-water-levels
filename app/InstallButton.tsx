"use client";

// "Install app" entry. variant "header": quiet button in the desktop header (icon only on mid widths).
// variant "row": a full-width row for the phone menu sheet. Renders nothing where install is not possible or already done.
import { Download } from "lucide-react";
import { rtFor } from "@/lib/i18n/return";
import { useI18n } from "./LocaleProvider";
import { useInstall } from "./InstallProvider";

const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";

export function InstallButton({ variant, source, onDone }: { variant: "header" | "row"; source: string; onDone?: () => void }) {
  const { lang } = useI18n();
  const { canInstall, install } = useInstall();
  const label = rtFor(lang)("ins.btn");
  if (!canInstall) return null;
  const click = () => {
    onDone?.();
    install(source);
  };
  if (variant === "row") {
    return (
      <button type="button" onClick={click} className={`flex w-full items-center gap-3 min-h-12 rounded-md px-2 text-left text-base font-medium hover:bg-slate-100 dark:hover:bg-slate-800 ${ring}`}>
        <Download className="size-5 text-slate-500 dark:text-slate-400" aria-hidden />
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={click}
      title={label}
      aria-label={label}
      className={`hidden sm:inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sky-700 dark:text-sky-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition ${ring}`}
    >
      <Download className="size-4" aria-hidden />
      <span className="hidden xl:inline">{label}</span>
    </button>
  );
}
