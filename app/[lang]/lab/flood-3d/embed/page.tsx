import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n/config";
import Flood3dMap from "../Flood3dMap";

// The flood test map as it appears inside a town page (app/flood/Flood3dEmbed.tsx opens it in an iframe): ?ll=<lon>,<lat>,<zoom> sets the view.
// Static and noindex. The site chrome (header, footer, tab bar, location banner) is hidden by the rule below, which only matches this page.
// Framing is allowed for our own origin only (next.config.ts sends frame-ancestors 'self' for this address).
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  return { title: { absolute: "Flood map test (embed)" }, robots: { index: false, follow: false, nocache: true } };
}

const HIDE_CHROME = "body:has([data-f3d-embed-root]){padding-bottom:0!important;min-height:0!important;overflow:hidden}body:has([data-f3d-embed-root])>*:not(:has([data-f3d-embed-root])):not(script):not(style){display:none!important}body:has([data-f3d-embed-root])>div:has([data-f3d-embed-root]){min-height:0!important}";

export default async function Flood3dEmbedPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return (
    <div data-f3d-embed-root>
      <style>{HIDE_CHROME}</style>
      <Flood3dMap lang={lang} embed />
    </div>
  );
}
