"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useI18n } from "./LocaleProvider";
import { photoUrl, type ReservoirPhoto } from "@/lib/reservoirPhotoData";

// Wikimedia serves thumbnails only at fixed widths, so the loader maps next/image's width to the
// right one and the browser fetches it from Wikimedia directly (no image-optimisation round trip).
const loader = ({ src, width }: { src: string; width: number }) => {
  const ph = JSON.parse(src) as ReservoirPhoto;
  return photoUrl(ph, width);
};
const asSrc = (ph: ReservoirPhoto) => JSON.stringify(ph);

function Credit({ ph, className = "" }: { ph: ReservoirPhoto; className?: string }) {
  const { t } = useI18n();
  const link = "underline underline-offset-2 hover:text-sky-700 dark:hover:text-sky-300";
  return (
    <p className={`text-xs text-slate-500 dark:text-slate-400 ${className}`}>
      {t("photos.credit")}{" "}
      <a href={ph.page} target="_blank" rel="noopener noreferrer" className={link}>{ph.author}</a>,{" "}
      {ph.licenseUrl ? <a href={ph.licenseUrl} target="_blank" rel="noopener noreferrer" className={link}>{ph.license}</a> : ph.license}{" "}
      <a href={ph.page} target="_blank" rel="noopener noreferrer" className={link}>{t("photos.via")}</a>
    </p>
  );
}

function Lightbox({ photos, index, onIndex, onClose, name }: { photos: ReservoirPhoto[]; index: number | null; onIndex: (i: number) => void; onClose: () => void; name: string }) {
  const { t } = useI18n();
  const dlg = useRef<HTMLDialogElement>(null);
  const open = index !== null;
  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const n = photos.length;
  const go = useCallback((d: number) => index !== null && onIndex((index + d + n) % n), [index, n, onIndex]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, go]);
  const ph = index !== null ? photos[index] : null;
  const btn = "inline-flex size-11 items-center justify-center rounded-lg bg-white/90 dark:bg-slate-900/90 text-slate-900 dark:text-slate-100 shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500";
  const touch = useRef<number | null>(null);
  return (
    <dialog
      ref={dlg}
      aria-label={name}
      onClose={onClose}
      onClick={(e) => e.target === dlg.current && onClose()}
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touch.current == null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        touch.current = null;
        if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
      }}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-black/90 p-0 backdrop:bg-black/80"
    >
      {ph && (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 pb-4 pt-16" onClick={(e) => e.target === e.currentTarget && onClose()}>
          <div className="relative min-h-0 w-full flex-1">
            <Image loader={loader} src={asSrc(ph)} alt={`${name}: ${ph.caption}`} fill sizes="100vw" className="object-contain" />
          </div>
          <div className="max-w-2xl text-center text-sm text-slate-200 [&_p]:text-slate-300 [&_a]:text-slate-100">
            <p className="font-medium !text-slate-100">{ph.caption}</p>
            <Credit ph={ph} className="mt-0.5" />
          </div>
        </div>
      )}
      <div className="fixed right-3 top-3 flex items-center gap-2" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        {n > 1 && index !== null && <span className="rounded-md bg-black/60 px-2 py-1 text-xs text-white tabular-nums">{t("photos.count", { i: index + 1, n })}</span>}
        <button type="button" className={btn} onClick={onClose} aria-label={t("img.close")}><X className="size-5" aria-hidden /></button>
      </div>
      {n > 1 && (
        <>
          <button type="button" className={`${btn} fixed left-2 top-1/2 -translate-y-1/2`} onClick={() => go(-1)} aria-label={t("photos.prev")}><ChevronLeft className="size-5" aria-hidden /></button>
          <button type="button" className={`${btn} fixed right-2 top-1/2 -translate-y-1/2`} onClick={() => go(1)} aria-label={t("photos.next")}><ChevronRight className="size-5" aria-hidden /></button>
        </>
      )}
    </dialog>
  );
}

/** Wide photo under the status strip (first photo) and, when there are several, a "Photos" grid. */
export function ReservoirPhotos({ photos, name, variant }: { photos: ReservoirPhoto[]; name: string; variant: "hero" | "gallery" }) {
  const { t } = useI18n();
  const [idx, setIdx] = useState<number | null>(null);
  if (!photos.length) return null;
  const close = () => setIdx(null);

  if (variant === "hero") {
    const ph = photos[0];
    return (
      <figure className="mb-3">
        <button
          type="button"
          onClick={() => setIdx(0)}
          aria-label={t("photos.open", { name: ph.caption })}
          className="relative block h-44 w-full cursor-zoom-in overflow-hidden rounded-xl border border-slate-200 bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-800 dark:bg-slate-800 sm:h-60"
        >
          <Image loader={loader} src={asSrc(ph)} alt={`${name}: ${ph.caption}`} fill priority sizes="(min-width: 768px) 768px, 100vw" className="object-cover" />
        </button>
        <figcaption className="mt-1.5 px-1"><Credit ph={ph} /></figcaption>
        <Lightbox photos={photos} index={idx} onIndex={setIdx} onClose={close} name={name} />
      </figure>
    );
  }

  return (
    <section className="mt-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:p-5" aria-label={t("photos.title")}>
      <h2 className="text-lg font-semibold">{t("photos.title")}</h2>
      <ul className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {photos.map((ph, i) => (
          <li key={ph.title}>
            <button
              type="button"
              onClick={() => setIdx(i)}
              aria-label={t("photos.open", { name: ph.caption })}
              className="relative block aspect-[16/10] w-full cursor-zoom-in overflow-hidden rounded-lg bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:bg-slate-800"
            >
              <Image loader={loader} src={asSrc(ph)} alt={`${name}: ${ph.caption}`} fill loading="lazy" sizes="(min-width: 768px) 360px, 100vw" className="object-cover" />
            </button>
            <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-200">{ph.caption}</p>
            <Credit ph={ph} className="mt-0.5" />
          </li>
        ))}
      </ul>
      <Lightbox photos={photos} index={idx} onIndex={setIdx} onClose={close} name={name} />
    </section>
  );
}
