import { ZoomableImage } from "./ZoomableImage";
import { WF_IMG } from "@/lib/research";

/** A research figure: tap to open full screen, caption underneath. The alt text carries the finding for readers who cannot see it. */
export function ResearchFigure({ file, w, h, alt, caption, n }: { file: string; w: number; h: number; alt: string; caption: string; n: string }) {
  return (
    <figure className="my-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 sm:p-3">
      <div className="overflow-hidden rounded-lg bg-white">
        <ZoomableImage src={`${WF_IMG}/${file}`} alt={alt} width={w} height={h} sizes="(min-width: 768px) 720px, 100vw" />
      </div>
      <figcaption className="mt-2 px-1 text-xs sm:text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        <span className="font-medium text-slate-800 dark:text-slate-200">Figure {n}.</span> {caption}
      </figcaption>
    </figure>
  );
}
