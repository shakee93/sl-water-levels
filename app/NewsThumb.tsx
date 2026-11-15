"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

// The small cover image of a news row (owner decision 15 Nov 2026). Decorative: the headline beside it says
// what the story is, so alt is empty. Served through next/image (never the outlet's file straight to the
// browser), lazy, fixed 96x64. If the file cannot load it renders nothing at all, so the row looks as it did
// before thumbnails (no empty box). The link is a second way to the same article, so it stays out of the tab order.
export function NewsThumb({ src, href }: { src: string; href: string }) {
  const [failed, setFailed] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  // an error that fired before hydration never reaches onError: check the element once mounted
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) setFailed(true);
  }, []);
  if (failed) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden className="mt-0.5 block h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
      <Image ref={img} src={src} alt="" width={96} height={64} loading="lazy" onError={() => setFailed(true)} className="h-16 w-24 object-cover" />
    </a>
  );
}
