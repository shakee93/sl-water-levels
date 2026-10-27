// The page for an address that does not exist. proxy.ts answers those with status 404 (see there), and Vercel serves
// this static page as the body. It stands alone (no header, locale or data fetch) so it can never fail or stream.
import "./globals.css";
import type { Metadata } from "next";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Page not found — Sri Lanka Water Levels",
  robots: { index: false, follow: true, googleBot: { index: false, follow: true } },
};

const links: [string, string][] = [
  ["/", "River levels now"],
  ["/rivers", "All rivers"],
  ["/flood", "Flood risk by town"],
  ["/reservoirs", "Reservoirs and spill gates"],
  ["/rain", "Rain map"],
  ["/help", "Help"],
];

export default function GlobalNotFound() {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-20">
          <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight">We couldn’t find that page</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-2 max-w-prose">The address may be old or mistyped. These pages are live:</p>
          <ul className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {links.map(([href, label]) => (
              // plain <a>: this page has no router or locale context
              <li key={href}>
                <a href={href} className="flex items-center rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 py-2.5 min-h-12 text-sm font-medium hover:border-sky-400 dark:hover:border-sky-700 transition">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </main>
      </body>
    </html>
  );
}
