// iOS Home Screen launch images. One entry per CSS-pixel screen size that Safari matches on (device-width x device-height
// x pixel ratio); scripts/splash.mjs draws the PNGs and app/[lang]/layout.tsx links them. No imports: the script loads
// this file with node --experimental-strip-types.
export type SplashDevice = { w: number; h: number; ratio: number; iPad?: boolean; name: string };

export const SPLASH_DEVICES: SplashDevice[] = [
  { w: 440, h: 956, ratio: 3, name: "iPhone 16/17 Pro Max" },
  { w: 402, h: 874, ratio: 3, name: "iPhone 16/17 Pro" },
  { w: 430, h: 932, ratio: 3, name: "iPhone 14 Pro Max, 15 Plus/Pro Max, 16 Plus" },
  { w: 393, h: 852, ratio: 3, name: "iPhone 14 Pro, 15, 15 Pro, 16" },
  { w: 428, h: 926, ratio: 3, name: "iPhone 12/13 Pro Max, 14 Plus" },
  { w: 390, h: 844, ratio: 3, name: "iPhone 12, 12 Pro, 13, 13 Pro, 14" },
  { w: 375, h: 812, ratio: 3, name: "iPhone X, XS, 11 Pro, 12/13 mini" },
  { w: 414, h: 896, ratio: 3, name: "iPhone XS Max, 11 Pro Max" },
  { w: 414, h: 896, ratio: 2, name: "iPhone XR, 11" },
  { w: 414, h: 736, ratio: 3, name: "iPhone 6/7/8 Plus" },
  { w: 375, h: 667, ratio: 2, name: "iPhone 6/7/8, SE 2/3" },
  { w: 320, h: 568, ratio: 2, name: "iPhone SE 1, 5s" },
  { w: 1032, h: 1376, ratio: 2, iPad: true, name: "iPad Pro 13 (M4)" },
  { w: 1024, h: 1366, ratio: 2, iPad: true, name: "iPad Pro 12.9" },
  { w: 834, h: 1210, ratio: 2, iPad: true, name: "iPad Pro 11 (M4)" },
  { w: 834, h: 1194, ratio: 2, iPad: true, name: "iPad Pro 11, Air 11 (M2)" },
  { w: 834, h: 1112, ratio: 2, iPad: true, name: "iPad Pro 10.5, Air 3" },
  { w: 820, h: 1180, ratio: 2, iPad: true, name: "iPad Air 4/5, iPad 10" },
  { w: 810, h: 1080, ratio: 2, iPad: true, name: "iPad 7/8/9" },
  { w: 768, h: 1024, ratio: 2, iPad: true, name: "iPad 9.7, mini 4/5" },
  { w: 744, h: 1133, ratio: 2, iPad: true, name: "iPad mini 6/7" },
];

export type SplashShot = { file: string; media: string; px: [number, number]; scheme: "light" | "dark" };

/** Every launch image: file name (under /splash/), media query, pixel size. iPhones portrait only, iPads both ways. */
export function splashShots(): SplashShot[] {
  const out: SplashShot[] = [];
  for (const d of SPLASH_DEVICES) {
    for (const landscape of d.iPad ? [false, true] : [false]) {
      const cssW = landscape ? d.h : d.w;
      const cssH = landscape ? d.w : d.h;
      for (const scheme of ["light", "dark"] as const) {
        out.push({
          file: `${cssW}x${cssH}@${d.ratio}-${scheme}.png`,
          media: `(device-width: ${d.w}px) and (device-height: ${d.h}px) and (-webkit-device-pixel-ratio: ${d.ratio}) and (orientation: ${landscape ? "landscape" : "portrait"}) and (prefers-color-scheme: ${scheme})`,
          px: [cssW * d.ratio, cssH * d.ratio],
          scheme,
        });
      }
    }
  }
  return out;
}
