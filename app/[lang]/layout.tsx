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
    >
      <body
        className="min-h-full flex flex-col bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
      >
        <LocaleProvider lang={lang} dict={DICTS[lang]}>
          <Suspense fallback={<HeaderFallback />}>
            <Header lang={lang} />
          </Suspense>
          <LangSideEffects />
          <LocationPrompt variant="banner" />
          <div className="flex-1">{children}</div>
          <Suspense fallback={null}>
            <Footer lang={lang} />
          </Suspense>
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
