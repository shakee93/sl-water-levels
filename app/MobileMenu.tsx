"use client";

// Phone-only "More" sheet, opened from the bottom tab bar (BottomTabs): every public section in the same groups as the
// footer (lib/navGroups.ts), then X, GitHub, install, alerts, language, theme and every river, in large tap targets.
// Rendered in a portal because the sticky header's backdrop blur would otherwise contain `fixed`.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Code, X } from "lucide-react";
import { useI18n } from "./LocaleProvider";
import { XLogo } from "./XLogo";
import { ThemeSegmented } from "./ThemeSwitch";
import { InstallButton } from "./InstallButton";
import { AlertSettingsRow } from "./AlertSettings";
import { OPEN_MENU_EVENT } from "./BottomTabs";
import { LangSwitch } from "./LanguageBar";
import { navSection } from "@/lib/navActive";
import { navGroups } from "@/lib/navGroups";
import { splitLocale } from "@/lib/i18n/config";

const ring =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";

export type MenuRiver = { href: string; label: string; slug: string; urlSlug: string };

export function MobileMenu({ rivers, xHandle = null }: { rivers: MenuRiver[]; xHandle?: string | null }) {
  const { t, p, lang } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
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
    const onOpen = () => {
      trigger.current = document.activeElement as HTMLElement | null;
      setOpen(true);
    };
    window.addEventListener(OPEN_MENU_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_MENU_EVENT, onOpen);
  }, []);

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

  const path = splitLocale(pathname || "/").path;
  const on = (base: string) => (base === "/" ? path === "/" : path === base || path.startsWith(base + "/"));
  const onRiver = navSection(pathname || "/", rivers.map((r) => r.urlSlug)) === "basins";
  const groups = navGroups(lang, t);
  const row = `flex items-center gap-3 min-h-12 rounded-md px-2 text-base font-medium hover:bg-slate-100 dark:hover:bg-slate-800 ${ring}`;

  return (
    <>
      {open &&
        createPortal(
          <div className="sm:hidden fixed inset-0 z-[60] bg-white dark:bg-slate-950" onKeyDown={onKey}>
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
                {groups.map((g) => (
                  <section key={g.id} aria-labelledby={`menu-${g.id}`} className="pt-3">
                    <h2 id={`menu-${g.id}`} className="px-2 text-sm font-semibold text-slate-600 dark:text-slate-300">{g.heading}</h2>
                    <ul className="py-1">
                      {g.items.map(({ href, label, icon: Icon, event }) => {
                        const active = on(href);
                        return (
                          <li key={href}>
                            <Link
                              href={p(href)}
                              onClick={close}
                              aria-current={active ? "page" : undefined}
                              data-umami-event={event}
                              className={`${row} ${active ? "bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300" : ""}`}
                            >
                              <Icon className={`size-5 ${active ? "" : "text-slate-500 dark:text-slate-400"}`} strokeWidth={active ? 2.25 : 1.75} aria-hidden />
                              {label}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}

                <ul className="py-2 mt-1 border-t border-slate-200 dark:border-slate-800">
                  {xHandle && (
                    <li>
                      <a
                        href={`https://x.com/${xHandle}`}
                        target="_blank"
                        rel="noreferrer me"
                        data-umami-event="x_click"
                        className={row}
                      >
                        <XLogo className="size-5 text-slate-500 dark:text-slate-400" />
                        <span>
                          @{xHandle}
                          <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">Live updates on X</span>
                        </span>
                      </a>
                    </li>
                  )}
                  <li>
                    <a
                      href="https://github.com/shakee93/sl-water-levels"
                      target="_blank"
                      rel="noreferrer"
                      data-umami-event="github_click"
                      className={row}
                    >
                      <Code className="size-5 text-slate-500 dark:text-slate-400" aria-hidden />
                      {t("footer.source")}
                    </a>
                  </li>
                  <li>
                    <InstallButton variant="row" source="menu" onDone={close} />
                  </li>
                  <li>
                    <AlertSettingsRow onDone={close} />
                  </li>
                </ul>

                <div className="flex items-center justify-between gap-3 px-2 py-2">
                  <span className="text-sm font-semibold text-slate-600 dark:text-slate-300">{t("lang.label")}</span>
                  <LangSwitch />
                </div>
                <ThemeSegmented />

                <h2 className="mt-5 mb-1 px-2 text-sm font-semibold text-slate-600 dark:text-slate-300">{t("nav.basins")}</h2>
                <ul className="grid grid-cols-2 gap-x-2">
                  {rivers.map((r) => (
                    <li key={r.href}>
                      <Link
                        href={r.href}
                        onClick={close}
                        data-umami-event="basin_nav_click"
                        data-umami-event-basin={r.slug}
                        aria-current={onRiver && (path === `/${r.urlSlug}` || path.startsWith(`/${r.urlSlug}/`)) ? "page" : undefined}
                        className={`flex items-center min-h-11 rounded-md px-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${ring} ${
                          onRiver && (path === `/${r.urlSlug}` || path.startsWith(`/${r.urlSlug}/`)) ? "bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 font-medium" : "text-slate-700 dark:text-slate-300"
                        }`}
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
