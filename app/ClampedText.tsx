"use client";

// Long official bulletins would push the verdict off a phone screen. Show three lines with a
// "More" button; wider screens always show everything.
import { useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "./LocaleProvider";

export function ClampedText({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  const { t } = useI18n();
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [children, open]);

  return (
    <>
      <p ref={ref} className={open ? "" : "line-clamp-3 sm:line-clamp-none"}>
        {children}
      </p>
      <span className="flex flex-wrap items-center gap-x-4">
        {(overflows || open) && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="sm:hidden min-h-11 underline underline-offset-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded"
          >
            {open ? t("common.less") : t("common.more")}
          </button>
        )}
        {footer}
      </span>
    </>
  );
}
