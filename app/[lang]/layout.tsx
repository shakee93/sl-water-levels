import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Geist, Geist_Mono, Noto_Sans_Sinhala, Noto_Sans_Tamil } from "next/font/google";
import Script from "next/script";
import "../globals.css";
import { Header } from "../Header";
import { Footer } from "../Footer";
import { LocationPrompt } from "../LocationPrompt";
import { LocaleProvider } from "../LocaleProvider";
import { LangSideEffects } from "../LanguageBar";
import { ThemeSync } from "../ThemeSync";
import { ReturnShell } from "../ReturnShell";
import { InstallProvider } from "../InstallProvider";
import { AlertSettingsProvider } from "../AlertSettings";
import { NavProgress } from "../NavProgress";
import { BottomTabs } from "../BottomTabs";
import { splashShots } from "@/lib/splash";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { HTML_LANG, LOCALES, OG_LOCALE, isLocale } from "@/lib/i18n/config";
import { DICTS, getI18n } from "@/lib/i18n/server";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Fallbacks for Sinhala/Tamil text on devices without those fonts. preload is
// off and the @font-face rules carry a unicode-range, so the files only download
// when such glyphs actually appear.
const notoSinhala = Noto_Sans_Sinhala({
  variable: "--font-sinhala",
  subsets: ["sinhala"],
  display: "swap",
  preload: false,
});

const notoTamil = Noto_Sans_Tamil({
  variable: "--font-tamil",
  subsets: ["tamil"],
  display: "swap",
  preload: false,
});

const SITE = "https://sl-water-levels.vercel.app";

// viewport-fit=cover lets the pages use env(safe-area-inset-*) on notched phones.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#020617" },
  ],
};

// Only /en, /si and /ta exist (anything else hits notFound() below). dynamicParams stays on so an
// unknown river or gauge under a real locale reaches our own 404 page instead of the bare default.
// (English is served unprefixed: proxy.ts rewrites / to /en.)

export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const { t } = getI18n(lang);
  return {
    metadataBase: new URL(SITE),
    title: {
      default: t("home.metaTitle"),
      template: `%s — ${t("site.name")}`,
    },
    description: t("home.layoutDesc"),
    applicationName: t("site.name"),
    // Home Screen app: short name under the icon, launch images (public/splash, scripts/splash.mjs), and a status bar
    // that follows the phone's light / dark setting with the page starting below it (no content under the clock).
    appleWebApp: {
      capable: true,
      title: "SL Water Levels",
      statusBarStyle: "default",
      startupImage: splashShots().map((x) => ({ url: `/splash/${x.file}`, media: x.media })),
    },
    other: { "apple-mobile-web-app-capable": "yes" },
    formatDetection: { telephone: false },
    authors: [{ name: "Shakeeb" }],
    openGraph: {
      type: "website",
      locale: OG_LOCALE[lang],
      siteName: t("site.name"),
      title: t("home.metaTitle"),
      description: t("home.ogDesc"),
    },
    twitter: {
      card: "summary_large_image",
      title: t("home.metaTitle"),
      description: t("home.twDesc"),
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-snippet": -1,
        "max-image-preview": "large",
      },
    },
    verification: {
      google: "QGIc3xJp0rurObFPoY3591l9lNYqpQxKzPeKE_ekPwY",
    },
  };
}

export default async function RootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return (
    <html
      lang={HTML_LANG[lang]}
      className={`${geistSans.variable} ${geistMono.variable} ${notoSinhala.variable} ${notoTamil.variable} h-full antialiased`}
      // the inline script below sets class="dark" and style.colorScheme before React hydrates
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body
        className="min-h-full flex flex-col bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 pb-[calc(3.5rem+env(safe-area-inset-bottom))] sm:pb-0"
      >
        <LocaleProvider lang={lang} dict={DICTS[lang]}>
          <InstallProvider>
          <AlertSettingsProvider>
          <Suspense fallback={null}>
            <NavProgress />
          </Suspense>
          <Suspense fallback={<HeaderFallback />}>
            <Header lang={lang} />
          </Suspense>
          <LangSideEffects />
          <ThemeSync />
          <LocationPrompt variant="banner" />
          <ReturnShell />
          {/* Reserve at least the visible height (viewport minus header and phone tab bar) so while a page is still
              streaming in, the footer stays below the fold instead of jumping up under a short skeleton. */}
          <div className="flex-1 min-h-[calc(100dvh-3.5rem-3.5rem-env(safe-area-inset-bottom)-env(safe-area-inset-top))] sm:min-h-[calc(100dvh-3.5rem)]">{children}</div>
          <Footer lang={lang} />
          <BottomTabs />
          </AlertSettingsProvider>
          </InstallProvider>
        </LocaleProvider>
        <Script
          defer
          src="https://analytics.freshpixl.com/script.js"
          data-website-id="a15ed279-5a97-4e07-8aa6-3d7431957c94"
        />
      </body>
    </html>
  );
}

function HeaderFallback() {
  return (
    <div className="sticky top-0 z-40 border-b border-slate-200/80 dark:border-slate-800/80 bg-white/85 dark:bg-slate-950/85 backdrop-blur h-14" />
  );
}
