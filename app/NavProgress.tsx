"use client";

// A thin bar along the top edge that starts the moment a link is tapped and finishes when the new page is in, so a
// slow page never looks frozen (Home Screen app especially, where there is no browser loading bar). No library.
//  - starts from a capture-phase click on an in-site <a> (before Next handles it), or from the "sl:nav-start" event
//    that code calling router.push can dispatch;
//  - creeps towards 90 % while waiting, jumps to 100 % when the path or query changes, then fades out;
//  - gives up after 12 s so it can never stay stuck. Reduced motion: no animation, the bar just appears and goes.
import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export const NAV_START_EVENT = "sl:nav-start";

export function NavProgress() {
  const bar = useRef<HTMLDivElement>(null);
  const state = useRef({ active: false, value: 0, tick: 0, safety: 0, fade: 0 });
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const st = state.current;
    const paint = (v: number) => {
      el.style.transform = `scaleX(${v / 100})`;
    };
    const stop = () => {
      window.clearInterval(st.tick);
      window.clearTimeout(st.safety);
    };
    const finish = () => {
      if (!st.active) return;
      st.active = false;
      stop();
      paint(100);
      window.clearTimeout(st.fade);
      st.fade = window.setTimeout(() => {
        el.style.opacity = "0";
      }, 120);
    };
    const start = () => {
      if (st.active) return;
      st.active = true;
      stop();
      window.clearTimeout(st.fade);
      el.style.transition = "none";
      el.style.opacity = "1";
      paint(0);
      void el.offsetWidth; // restart from zero
      el.style.transition = "";
      st.value = 18;
      paint(st.value);
      st.tick = window.setInterval(() => {
        st.value += (92 - st.value) * 0.08;
        paint(st.value);
      }, 200);
      st.safety = window.setTimeout(finish, 12_000);
    };

    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return; // same page or only a #hash
      start();
    };
    const onEvent = () => start();
    const onShow = () => finish();
    document.addEventListener("click", onClick, true);
    window.addEventListener(NAV_START_EVENT, onEvent);
    window.addEventListener("pageshow", onShow);
    (el as HTMLElement & { _finish?: () => void })._finish = finish;
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener(NAV_START_EVENT, onEvent);
      window.removeEventListener("pageshow", onShow);
      stop();
    };
  }, []);

  // a new path or query means the page arrived
  useEffect(() => {
    (bar.current as (HTMLDivElement & { _finish?: () => void }) | null)?._finish?.();
  }, [pathname, search]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[80] h-[3px]">
      <div
        ref={bar}
        className="h-full w-full origin-left bg-sky-500 dark:bg-sky-400 opacity-0 shadow-[0_0_6px_rgba(14,165,233,0.6)] transition-[transform,opacity] duration-200 ease-out"
        style={{ transform: "scaleX(0)" }}
      />
    </div>
  );
}
