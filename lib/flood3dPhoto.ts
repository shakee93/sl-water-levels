// Photo helpers for the 3D flood test map reports (pure, so the route and scripts/flood3d.test.mts share them).
// Photos are private evidence for checking reports: the browser resizes to a JPEG of at most 2048 px, the route strips every metadata
// segment again before storing (EXIF incl. GPS, XMP, comments), and the original capture time and an EXIF-GPS-agrees flag are kept only as
// small facts in D1. Never shown publicly (moderation status pending / ok / rejected, owner review later).

export const MAX_PHOTO_BYTES = 3_500_000; // the route runs under Vercel's 4.5 MB body limit; a resized JPEG is normally well under 1 MB
export const MAX_PHOTOS_PER_REPORT = 3;
export const MAX_PHOTOS_PER_PERSON_DAY = 6;
export const PHOTO_TOKEN_MAX_AGE_MS = 30 * 60_000;

/** Metres between two points (haversine). */
export function distM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** 1 = the photo's own GPS is within 200 m of the pin, 0 = it disagrees, null = the photo had no GPS. */
export function exifAgree(pin: { lat: number; lon: number }, gps: string | null | undefined): 0 | 1 | null {
  if (!gps) return null;
  const [la, lo] = gps.split(",").map(Number);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  return distM(pin, { lat: la, lon: lo }) <= 200 ? 1 : 0;
}

/**
 * Re-emit a JPEG with every metadata segment removed: keeps SOI, JFIF APP0, the tables and the image data; drops APP1..APP15 (EXIF, XMP, ICC,
 * Photoshop) and COM. Returns null when the bytes are not a well-formed JPEG header chain.
 */
export function stripJpeg(buf: Uint8Array): Uint8Array | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  const chunks: Uint8Array[] = [new Uint8Array([0xff, 0xd8])];
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    let m = buf[i + 1];
    while (m === 0xff && i + 2 < buf.length) { i++; m = buf[i + 1]; } // fill bytes
    if (m === 0xd9) { chunks.push(new Uint8Array([0xff, 0xd9])); i += 2; break; }
    if (m === 0xda) { chunks.push(buf.subarray(i)); i = buf.length; break; } // start of scan: the rest is image data to the end
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) { chunks.push(buf.subarray(i, i + 2)); i += 2; continue; }
    if (i + 4 > buf.length) return null;
    const len = (buf[i + 2] << 8) | buf[i + 3];
    if (len < 2 || i + 2 + len > buf.length) return null;
    const drop = (m >= 0xe1 && m <= 0xef) || m === 0xfe;
    if (!drop) chunks.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const res = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { res.set(c, o); o += c.length; }
  return res;
}
