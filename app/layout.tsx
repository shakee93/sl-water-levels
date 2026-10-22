import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono, Noto_Sans_Sinhala, Noto_Sans_Tamil } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Header } from "./Header";
import { Footer } from "./Footer";

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

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "Sri Lanka Water Levels Today – Live River Gauges & Flood Levels",
    template: "%s — Sri Lanka Water Levels",
  },
  description:
    "Realtime water-level readings from Sri Lanka Department of Irrigation river gauges, plotted against alert, minor-flood and major-flood thresholds for every major basin — Kelani, Mahaweli, Kalu, Nilwala and more.",
  applicationName: "Sri Lanka Water Levels",
  authors: [{ name: "Shakeeb" }],
  openGraph: {
    type: "website",
    locale: "en_LK",
    url: SITE,
    siteName: "Sri Lanka Water Levels",
    title: "Sri Lanka Water Levels Today – Live River Gauges & Flood Levels",
    description:
      "Live river-gauge readings + next-hour flood forecast for every basin in Sri Lanka, updated every minute.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Sri Lanka Water Levels Today – Live River Gauges & Flood Levels",
    description: "Live river-gauge readings + next-hour flood forecast for every basin in Sri Lanka.",
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
  alternates: {
    canonical: "/",
  },
  verification: {
    google: "QGIc3xJp0rurObFPoY3591l9lNYqpQxKzPeKE_ekPwY",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${notoSinhala.variable} ${notoTamil.variable} h-full antialiased`}
    >
      <body
        className="min-h-full flex flex-col bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
        style={{ fontFamily: "Arial, Helvetica, var(--font-sinhala), var(--font-tamil), sans-serif" }}
      >
        <Suspense fallback={<HeaderFallback />}>
          <Header />
        </Suspense>
        <div className="flex-1">{children}</div>
        <Suspense fallback={null}>
          <Footer />
        </Suspense>
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
