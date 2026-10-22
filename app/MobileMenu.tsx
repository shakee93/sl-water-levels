"use client";

// Phone-only navigation sheet: History / About / Help and every river, in large tap targets.
// Rendered in a portal because the sticky header's backdrop blur would otherwise contain `fixed`.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LifeBuoy, Info, History, Menu, X } from "lucide-react";
import { useI18n } from "./LocaleProvider";

const ring =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";

export type MenuRiver = { href: string; label: string; slug: string };

export function MobileMenu({ rivers }: { rivers: MenuRiver[] }) {
  const { t, p } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  // Leaving the page closes the sheet.
  const [seen, setSeen] = useState(pathname);
  if (seen !== pathname) {
    setSeen(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtn.current?.focus();
    const btn = trigger.current;
    return () => {
      document.body.style.overflow = prev;
      btn?.focus();
    };
  }, [open]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab" && panel.current) {
      const f = [...panel.current.querySelectorAll<HTMLElement>("button, a[href]")];
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const main = [
    { href: p("/help"), label: t("nav.help"), icon: LifeBuoy, event: "help_nav_click" },
    { href: p("/history"), label: t("nav.history"), icon: History, event: "history_nav_click" },
    { href: p("/about"), label: t("nav.about"), icon: Info, event: "about_nav_click" },
  ];

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("nav.menu")}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`sm:hidden inline-flex items-center justify-center h-11 w-10 rounded-md text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition ${ring}`}
      >
        <Menu className="size-5" aria-hidden />
      </button>

      {open &&
        createPortal(
          <div className="sm:hidden fixed inset-0 z-50 bg-white dark:bg-slate-950" onKeyDown={onKey}>
            <div
              ref={panel}
              role="dialog"
              aria-modal="true"
              aria-label={t("nav.menu")}
              className="h-full flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-slate-900 dark:text-slate-100"
            >
              <div className="flex items-center justify-between h-14 pl-4 pr-2.5 pl-[max(1rem,env(safe-area-inset-left))] border-b border-slate-200 dark:border-slate-800 shrink-0">
                <span className="text-base font-semibold tracking-tight">{t("nav.menu")}</span>
                <button
                  ref={closeBtn}
                  type="button"
                  onClick={close}
                  aria-label={t("nav.menuClose")}
                  className={`inline-flex items-center justify-center size-11 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 ${ring}`}
                >
                  <X className="size-5" aria-hidden />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
                <ul className="py-2">
                  {main.map(({ href, label, icon: Icon, event }) => (
                    <li key={href}>
                      <Link
                        href={href}
                        onClick={close}
                        data-umami-event={event}
                        className={`flex items-center gap-3 min-h-12 rounded-md px-2 text-base font-medium hover:bg-slate-100 dark:hover:bg-slate-800 ${ring}`}
                      >
                        <Icon className="size-5 text-slate-500 dark:text-slate-400" aria-hidden />
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>

                <h2 className="mt-3 mb-1 px-2 text-sm font-semibold text-slate-600 dark:text-slate-300">{t("nav.basins")}</h2>
                <ul className="grid grid-cols-2 gap-x-2">
                  {rivers.map((r) => (
                    <li key={r.href}>
                      <Link
                        href={r.href}
                        onClick={close}
                        data-umami-event="basin_nav_click"
                        data-umami-event-basin={r.slug}
                        className={`flex items-center min-h-11 rounded-md px-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 ${ring}`}
                      >
                        {r.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
