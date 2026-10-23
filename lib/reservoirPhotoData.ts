// Photos of each reservoir, from lib/reservoirPhotos.json (made by scripts/reservoir-photos.mjs).
// Every file is freely licensed on Wikimedia Commons; the credit line is required by CC BY / CC BY-SA.
import data from "./reservoirPhotos.json";

export type ReservoirPhoto = {
  title: string;
  page: string;
  /** Path of the original under upload.wikimedia.org/wikipedia/commons/. */
  path: string;
  width: number;
  height: number;
  author: string;
  license: string;
  licenseUrl: string | null;
  caption: string;
};

const MAP = (data as { reservoirs: Record<string, ReservoirPhoto[]> }).reservoirs;
const BASE = "https://upload.wikimedia.org/wikipedia/commons/";

export const photosFor = (slug: string): ReservoirPhoto[] => MAP[slug] ?? [];

// Wikimedia only serves thumbnails at a few fixed widths.
const STEPS = [250, 330, 500, 960, 1280, 1920];

/** Wikimedia's own thumbnail at the smallest standard width >= w (the original when it is narrower). */
export function photoUrl(ph: ReservoirPhoto, w: number): string {
  const step = STEPS.find((s) => s >= w) ?? STEPS[STEPS.length - 1];
  if (ph.width <= step) return BASE + ph.path;
  const name = ph.path.split("/").pop()!;
  const ext = name.split(".").pop()!.toLowerCase();
  return `${BASE}thumb/${ph.path}/${step}px-${name}${ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp" ? "" : ".jpg"}`;
}

/** schema.org ImageObject for a photo that is shown on the page. */
export const photoLd = (ph: ReservoirPhoto) => ({
  "@type": "ImageObject",
  contentUrl: photoUrl(ph, 1280),
  url: ph.page,
  name: ph.caption,
  width: ph.width,
  height: ph.height,
  creditText: `${ph.author}, ${ph.license} via Wikimedia Commons`,
  creator: { "@type": "Person", name: ph.author },
  license: ph.licenseUrl ?? undefined,
  acquireLicensePage: ph.page,
});
