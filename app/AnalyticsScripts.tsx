// Google Analytics and the Umami-style counter, kept out of the root layout file.
import Script from "next/script";

export function AnalyticsScripts({ gaId }: { gaId: string }) {
  return (
    <>
    {/* Google Analytics (G-NDXLV0T8QC, property "waterlevels.lk", created 27 Oct 2026): loaded after the page is idle so it
        never slows the first view; production host only; Google signals and ad personalisation off. Privacy note: /about#privacy. */}
    <Script id="ga-init" strategy="lazyOnload">{`if(location.hostname==="waterlevels.lk"){window.dataLayer=window.dataLayer||[];window.gtag=function(){dataLayer.push(arguments)};gtag("js",new Date());gtag("config","${gaId}",{allow_google_signals:false,allow_ad_personalization_signals:false});var s=document.createElement("script");s.async=true;s.src="https://www.googletagmanager.com/gtag/js?id=${gaId}";document.head.appendChild(s);}`}</Script>
    <Script
      defer
      src="https://analytics.freshpixl.com/script.js"
      data-website-id="a15ed279-5a97-4e07-8aa6-3d7431957c94"
    />
    </>
  );
}
