// MapLibre, loaded on demand from our own static files: nothing of it is in any page bundle. Shared by the full flood map and the small
// "mark your spot" map in the "Is this right?" card.
import type { Map as MlMap } from "maplibre-gl";
export type Ml = typeof import("maplibre-gl");
export type { MlMap };

export const ML_VERSION = "5.24.0"; // files in /public/flood3d/ml are copied from the maplibre-gl@5.24.0 npm package (CSP build: no inline worker, works with Next)
let mlPromise: Promise<Ml> | null = null;
/** Loads MapLibre on demand from our own static files: nothing of it is in the page bundle. */
export function loadMl(): Promise<Ml> {
  mlPromise ??= new Promise<Ml>((resolve, reject) => {
    const w = window as unknown as { maplibregl?: Ml };
    if (w.maplibregl) return resolve(w.maplibregl);
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = `/flood3d/ml/maplibre-gl.css?v=${ML_VERSION}`; document.head.appendChild(css);
    const sc = document.createElement("script"); sc.src = `/flood3d/ml/maplibre-gl-csp.js?v=${ML_VERSION}`; sc.async = true;
    sc.onload = () => { const ml = w.maplibregl!; ml.setWorkerUrl(`/flood3d/ml/maplibre-gl-csp-worker.js?v=${ML_VERSION}`); resolve(ml); };
    sc.onerror = () => { mlPromise = null; reject(new Error("maplibre")); };
    document.head.appendChild(sc);
  });
  return mlPromise;
}

