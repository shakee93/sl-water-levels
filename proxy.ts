// Locale routing. English keeps the existing URLs (/, /kelani-ganga, /help ...); Sinhala is /si/...
// and Tamil /ta/.... The pages live under app/[lang]/, so an unprefixed request is rewritten
// (internally) to /en/<path>. Every page stays statically generated / ISR: this runs before the
// cache and never makes a route dynamic.
//
// - /en/... is not a public URL: it redirects to the unprefixed one (image routes excepted,
//   because Next emits their /en/... URLs in the OG meta tags).
// - A returning visitor whose "sl_lang" cookie says si/ta is redirected from an English URL to
//   the same page in their language (temporary redirect; never based on Accept-Language).
// - Old /history?scope=... links are sent to a tiny route handler that 308s to the clean URL.
import { NextResponse, type NextRequest } from "next/server";
import { LANG_KEY, isLocale, localePath, type Locale } from "@/lib/i18n/config";

const IMAGE = /\/(opengraph|twitter)-image(-[\w]+)?$/;

export function proxy(req: NextRequest) {
  const url = req.nextUrl;
  const m = /^\/(en|si|ta)(\/.*)?$/.exec(url.pathname);
  let lang: Locale = "en";
  let path = url.pathname;

  if (m) {
    lang = m[1] as Locale;
    path = m[2] ?? "/";
    if (lang === "en") {
      if (IMAGE.test(path)) return NextResponse.next();
      const to = url.clone();
      to.pathname = path;
      return NextResponse.redirect(to, 308);
    }
  } else {
    const saved = req.cookies.get(LANG_KEY)?.value;
    if (isLocale(saved) && saved !== "en" && !IMAGE.test(path)) {
      const to = url.clone();
      to.pathname = localePath(saved, path);
      return NextResponse.redirect(to, 307);
    }
  }

  const scope = path === "/history" ? url.searchParams.get("scope") : null;
  if (scope) {
    const to = url.clone();
    to.pathname = `/${lang}/history/go/${encodeURIComponent(scope)}`;
    to.search = "";
    return NextResponse.rewrite(to);
  }

  if (m) return NextResponse.next();
  const to = url.clone();
  to.pathname = `/en${path === "/" ? "" : path}`;
  return NextResponse.rewrite(to);
}

export const config = {
  matcher: ["/((?!api(?:/|$)|mcp(?:/|$)|_next|.*\\..*).*)"],
};
