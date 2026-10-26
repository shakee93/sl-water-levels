// One "where am I?" for the near-me buttons. Umami showed ~4 in 10 near-me errors were timeouts
// (code 3) with an 8 s limit: phones indoors often need longer for a first fix. So: first try a
// quick low-accuracy fix (accepting one up to 30 min old), and on a timeout or "unavailable" try once
// more with GPS allowed and a longer limit before giving up. Permission denied is final.

export type Located = { ok: true; lat: number; lon: number; retried: boolean };
export type LocateFailed = { ok: false; code: number; denied: boolean; retried: boolean };

function once(opts: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, opts));
}

export async function locate(): Promise<Located | LocateFailed> {
  try {
    const p = await once({ enableHighAccuracy: false, timeout: 12_000, maximumAge: 30 * 60_000 });
    return { ok: true, lat: p.coords.latitude, lon: p.coords.longitude, retried: false };
  } catch (e) {
    const err = e as GeolocationPositionError;
    if (err.code === err.PERMISSION_DENIED) return { ok: false, code: err.code, denied: true, retried: false };
    try {
      const p = await once({ enableHighAccuracy: true, timeout: 20_000, maximumAge: Infinity });
      return { ok: true, lat: p.coords.latitude, lon: p.coords.longitude, retried: true };
    } catch (e2) {
      const err2 = e2 as GeolocationPositionError;
      return { ok: false, code: err2.code, denied: err2.code === err2.PERMISSION_DENIED, retried: true };
    }
  }
}
