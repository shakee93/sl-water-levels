// Client side of report photos: read the capture time and GPS from the original's EXIF (as hints), then resize to a JPEG of at most
// 2048 px at about 80% quality. The re-encoded copy has no metadata at all; the server strips again anyway.
export type Prepared = { blob: Blob; exifTime: string | null; exifGps: string | null; name: string; previewUrl: string };

const u16 = (v: DataView, o: number, le: boolean) => v.getUint16(o, le);
const u32 = (v: DataView, o: number, le: boolean) => v.getUint32(o, le);

/** Minimal EXIF reader for JPEG: DateTimeOriginal (0x9003) and GPS latitude/longitude. Returns nulls when absent or unreadable. */
export function readExif(buf: ArrayBuffer): { time: string | null; gps: string | null } {
  const none = { time: null, gps: null };
  try {
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xffd8) return none;
    let o = 2;
    while (o + 4 < v.byteLength) {
      const m = v.getUint16(o), len = v.getUint16(o + 2);
      if (m === 0xffe1 && v.getUint32(o + 4) === 0x45786966) { // "Exif"
        const t = o + 10, le = v.getUint16(t) === 0x4949;
        const ifd0 = t + u32(v, t + 4, le);
        let time: string | null = null, gpsIfd = 0, exifIfd = 0;
        const readIfd = (ifd: number, cb: (tag: number, type: number, cnt: number, valOff: number) => void) => {
          const n = u16(v, ifd, le);
          for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; cb(u16(v, e, le), u16(v, e + 2, le), u32(v, e + 4, le), e + 8); }
        };
        readIfd(ifd0, (tag, _t, _c, vo) => { if (tag === 0x8769) exifIfd = t + u32(v, vo, le); else if (tag === 0x8825) gpsIfd = t + u32(v, vo, le); });
        if (exifIfd) readIfd(exifIfd, (tag, _t, cnt, vo) => { if (tag === 0x9003 && cnt >= 19) { const s = t + u32(v, vo, le); time = String.fromCharCode(...new Uint8Array(buf, s, 19)); } });
        let gps: string | null = null;
        if (gpsIfd) {
          let latRef = "N", lonRef = "E", lat = NaN, lon = NaN;
          const rat = (vo: number) => { const s = t + u32(v, vo, le); const r = (k: number) => u32(v, s + k * 8, le) / (u32(v, s + k * 8 + 4, le) || 1); return r(0) + r(1) / 60 + r(2) / 3600; };
          readIfd(gpsIfd, (tag, _t, _c, vo) => {
            if (tag === 1) latRef = String.fromCharCode(v.getUint8(vo));
            else if (tag === 3) lonRef = String.fromCharCode(v.getUint8(vo));
            else if (tag === 2) lat = rat(vo);
            else if (tag === 4) lon = rat(vo);
          });
          if (Number.isFinite(lat) && Number.isFinite(lon)) gps = `${(latRef === "S" ? -lat : lat).toFixed(5)},${(lonRef === "W" ? -lon : lon).toFixed(5)}`;
        }
        return { time: time ? String(time).replace(/^(\d{4}):(\d{2}):(\d{2}) /, "$1-$2-$3T") : null, gps };
      }
      o += 2 + len;
    }
  } catch { /* unreadable EXIF: no hints */ }
  return none;
}

/** Resize a photo to a metadata-free JPEG. Throws "format" when it cannot be decoded (HEIC goes through a decoder loaded on demand), "size" when still too big. */
export async function preparePhoto(file: File): Promise<Prepared> {
  if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) throw new Error("format");
  if (file.size > 30_000_000) throw new Error("size");
  let exifTime: string | null = null, exifGps: string | null = null;
  if (/jpe?g/i.test(file.type) || /\.jpe?g$/i.test(file.name)) { const e = readExif(await file.arrayBuffer()); exifTime = e.time; exifGps = e.gps; }
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch {
    // iPhone photos are HEIC, which only Safari decodes: elsewhere a HEIC decoder (heic-to, ~3 MB, loaded only now) turns it into a bitmap
    if (!/hei[cf]/i.test(file.type) && !/\.hei[cf]$/i.test(file.name)) throw new Error("format");
    try { const { heicTo } = await import("heic-to/next"); bmp = await heicTo({ blob: file, type: "bitmap", options: { imageOrientation: "from-image" } }); } catch { throw new Error("format"); }
  }
  const k = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.8));
  if (!blob) throw new Error("format");
  if (blob.size > 3_400_000) throw new Error("size");
  return { blob, exifTime, exifGps, name: file.name, previewUrl: URL.createObjectURL(blob) };
}
