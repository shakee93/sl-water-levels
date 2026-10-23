"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { Maximize2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useI18n } from "./LocaleProvider";

// An image that opens full screen on tap. In the viewer it fits the screen; "Zoom in" shows it
// at full resolution so the labels can be read and panned (and phones can pinch as usual).
// Native <dialog>: focus trap, Esc to close, back-drop click closes.
export function ZoomableImage({
  src,
  alt,
  width,
  height,
  sizes,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  sizes: string;
}) {
  const { t } = useI18n();
  const dlg = useRef<HTMLDialogElement>(null);
  const [zoomed, setZoomed] = useState(false);
  const open = () => {
    setZoomed(false);
    dlg.current?.showModal();
  };
  const close = () => dlg.current?.close();
  const btn =
    "inline-flex items-center gap-1.5 h-11 px-3 rounded-lg bg-white/90 dark:bg-slate-900/90 text-slate-900 dark:text-slate-100 text-sm font-medium shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500";

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label={t("img.open")}
        className="group relative block w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded-lg"
      >
        <Image src={src} alt={alt} width={width} height={height} sizes={sizes} className="h-auto w-full" />
        <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-slate-900/70 px-2 py-1 text-xs text-white opacity-90 group-hover:opacity-100">
          <Maximize2 className="size-3.5" aria-hidden />
          {t("img.full")}
        </span>
      </button>

      <dialog
        ref={dlg}
        aria-label={alt}
        onClick={(e) => {
          if (e.target === dlg.current) close();
        }}
        onClose={() => setZoomed(false)}
        className="m-0 h-dvh max-h-none w-screen max-w-none bg-black/90 p-0 backdrop:bg-black/80"
      >
        <div className={`h-full w-full ${zoomed ? "overflow-auto" : "flex items-center justify-center overflow-hidden"}`}>
          {/* Full-resolution file in the viewer so text stays sharp when zoomed. */}
          <Image
            src={src}
            alt={alt}
            width={width}
            height={height}
            sizes={zoomed ? `${width}px` : "100vw"}
            onClick={() => setZoomed((z) => !z)}
            className={zoomed ? "max-w-none cursor-zoom-out" : "max-h-full w-auto max-w-full object-contain cursor-zoom-in"}
            style={zoomed ? { width: `${width}px`, height: "auto" } : undefined}
          />
        </div>
        <div className="fixed right-3 top-3 flex gap-2" style={{ paddingTop: "env(safe-area-inset-top)" }}>
          <button type="button" className={btn} onClick={() => setZoomed((z) => !z)}>
            {zoomed ? <ZoomOut className="size-4" aria-hidden /> : <ZoomIn className="size-4" aria-hidden />}
            {zoomed ? t("img.fit") : t("img.zoom")}
          </button>
          <button type="button" className={btn} onClick={close} aria-label={t("img.close")}>
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </dialog>
    </>
  );
}
