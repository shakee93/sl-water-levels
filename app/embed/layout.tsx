// Root layout of the embeddable widgets (/embed/<widget>). Deliberately NOT the site layout: no header, footer, install prompt,
// service worker or Google Analytics / page-view counter here. The only analytics is the one `embed_view` event (EmbedApp.tsx).
import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Geist, Noto_Sans_Sinhala, Noto_Sans_Tamil } from "next/font/google";
import "../globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const notoSinhala = Noto_Sans_Sinhala({ variable: "--font-sinhala", subsets: ["sinhala"], display: "swap", preload: false });
const notoTamil = Noto_Sans_Tamil({ variable: "--font-tamil", subsets: ["tamil"], display: "swap", preload: false });

export const metadata: Metadata = { title: "Live river levels", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, colorScheme: "light dark" };

// ?theme=light|dark|auto (auto follows the visitor's OS) and ?lang= before first paint: the page background is transparent-free
// (solid) so the widget looks the same on any host page.
const INIT = `(function(){try{var q=new URLSearchParams(location.search),t=q.get("theme"),d=t==="dark"||(t==="auto"&&matchMedia("(prefers-color-scheme: dark)").matches),r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light";var l=q.get("lang");if(l==="si"||l==="ta")r.lang=l}catch(e){}})()`;

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${notoSinhala.variable} ${notoTamil.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: INIT }} />
      </head>
      <body className="text-slate-900 dark:text-slate-100" style={{ background: "transparent" }}>
        {children}
        {/* Umami with page views OFF: only the explicit embed_view event is sent. No Google Analytics here. */}
        <Script defer src="https://analytics.freshpixl.com/script.js" data-website-id="a15ed279-5a97-4e07-8aa6-3d7431957c94" data-auto-track="false" />
      </body>
    </html>
  );
}
