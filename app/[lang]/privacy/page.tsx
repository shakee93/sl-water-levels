import Link from "next/link";
import type { Metadata } from "next";
import { ogBase } from "@/lib/seoMeta";
import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { JsonLd } from "@/app/Answer";
import { IG_HANDLE, IG_URL, OWNER, REPO, SITE, X_HANDLE, breadcrumbLd, publisherLd, webPageLd } from "@/lib/seo";

// Static page: no data fetch, so it is built once.
export const revalidate = 86400;

// Written in English for every language, like /data, and always canonical to the English URL (the footer link is the same in si/ta).
// Every statement below was checked against the code on UPDATED (app/, lib/, d1/, scripts/, workers/). When the code changes
// what is collected, change this page in the same commit.
// TODO(owner): there is no contact form or address on the site. The page points to the public X and Instagram accounts and to
// GitHub issues. If you want a dedicated privacy contact (Meta does not require one), add it to the "Contact" section.
const UPDATED = "15 November 2026";
const TITLE = "Privacy policy";
const DESC = "What waterlevels.lk stores about visitors, in plain words: cookies, optional alerts, flood reports, analytics and our social accounts.";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  return {
    title: TITLE,
    description: DESC,
    alternates: { canonical: "/privacy" },
    openGraph: { ...ogBase(lang), title: TITLE, description: DESC, url: `${SITE}/privacy`, type: "website" },
  };
}

const card = "rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6";
const link = "underline decoration-slate-400/40 hover:text-sky-700 dark:hover:text-sky-300";

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className={`${card} scroll-mt-20 space-y-2`} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

export default async function PrivacyPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const { t, p } = getI18n(lang);
  return (
    <main className="bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <JsonLd
        graph={[
          webPageLd({ lang: "en", path: "/privacy", name: TITLE, description: DESC, modified: Date.parse("2026-11-15"), type: "WebPage" }),
          breadcrumbLd([{ name: t("crumb.home"), path: "/" }, { name: TITLE, path: "/privacy" }], "en"),
          publisherLd(),
        ]}
      />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-12">
        <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          <Link href={p("/")} className="hover:underline inline-block py-3 -my-3">{t("crumb.home")}</Link> <span aria-hidden>›</span>{" "}
          <span className="text-slate-700 dark:text-slate-300">{TITLE}</span>
        </nav>
        <header className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight">Privacy policy</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-2 max-w-prose">
            waterlevels.lk shows river and reservoir levels for Sri Lanka. There are no accounts and no sign-in. This page says what we keep about you, why, and how to remove it. Last updated {UPDATED}.
          </p>
        </header>

        <div className="space-y-5 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
          <Section id="who" title="Who runs this site">
            <p>
              waterlevels.lk (Sri Lanka Water Levels) is an independent, non-commercial project run by {OWNER.name}. It is not an official service of the Irrigation Department or the Disaster Management Centre. We do not sell your data, and we do not use it for advertising.
            </p>
          </Section>

          <Section id="short" title="In short">
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Browsing the site needs no account. Your saved places, street level, language and theme stay in your own browser.</li>
              <li>We count visits with two analytics tools (below).</li>
              <li>We store something on our server only if you choose to: turn on alerts, answer &ldquo;Is this right?&rdquo;, or send a flood report or survey answer.</li>
              <li>Your exact map position is never published. The public only ever sees counts for an area, and only when at least 3 people reported.</li>
              <li>Our Instagram, X and Facebook Page only post public river data. We do not collect data from people who follow or reply to them through this site.</li>
            </ul>
          </Section>

          <Section id="cookies" title="Cookies and browser storage">
            <p>These are small items kept in your own browser. We read them to make the site remember you; they hold no name, email or account.</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li><strong>sl_lang</strong> (cookie and local storage, 1 year): your chosen language (English, Sinhala or Tamil).</li>
              <li><strong>sl_station</strong> (cookie, 1 year): the gauge you last picked in the station picker.</li>
              <li><strong>sl_has_data</strong> (cookie, 1 year): a flag that your browser holds saved places, so a move to a new address can carry them over. It holds no place names.</li>
              <li><strong>sl_fr_&lt;town&gt;</strong> and <strong>sl_fb_&lt;page&gt;_&lt;place&gt;</strong> (cookies, 24 hours): set after you answer a street-water or &ldquo;Is this right?&rdquo; question, so the same browser is not asked again that day.</li>
              <li><strong>Local storage on your device only</strong> (never sent to us): saved places (<code>sl_favourites</code>), your street level (<code>sl_my_levels</code>), low spots (<code>sl_low_spots</code>), recent searches, theme, and your approximate position if you allowed it (<code>sl_loc</code>, rounded to about 1 km). Location is asked only when you tap a button, and &ldquo;Forget my location&rdquo; removes it.</li>
              <li><strong>Google Analytics cookies</strong> (<code>_ga</code>, <code>_ga_*</code>): see Analytics.</li>
            </ul>
            <p>You can clear all of this in your browser settings at any time. The site keeps working; it just forgets your choices.</p>
          </Section>

          <Section id="analytics" title="Analytics">
            <p>We want to know which pages help people, so we use two tools. Neither is used for advertising.</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li><strong>Google Analytics</strong>, loaded only on waterlevels.lk after the page has loaded. It sets cookies and sends page views and button-click events to Google. Google signals and ad personalisation are switched off. Google&rsquo;s own policy applies to what it does with that data. You can block it with a browser extension or Google&rsquo;s opt-out add-on.</li>
              <li><strong>Umami</strong>, a privacy-focused counter loaded from analytics.freshpixl.com. It sets no cookies. It records page views and the same button-click events.</li>
            </ul>
            <p>Event names such as &ldquo;opened the flood map&rdquo; are sent. Your saved places, location and report answers are not.</p>
          </Section>

          <Section id="alerts" title="Alerts (web push)">
            <p>Alerts are optional and start only when you tap the alerts button and allow notifications in your browser. We then store, on our server (Cloudflare D1):</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>your browser&rsquo;s push address (the endpoint your browser gives us) and its two public keys, which are needed to send you a message;</li>
              <li>the places you chose, your page language, and your alert settings (which kinds of alert, morning summary and its time, quiet hours);</li>
              <li>when you subscribed, the last successful send, and a count of failed sends.</li>
            </ul>
            <p>We do not store your name, email, phone number or location for alerts. Messages are signed with our VAPID key and delivered through your browser maker&rsquo;s push service (for example Google or Mozilla), which sees that a message was sent to your browser.</p>
            <p><strong>To stop:</strong> use &ldquo;Turn off alerts&rdquo; in the alert settings. That deletes your subscription and settings from our database at once. A subscription that your browser reports as gone, or that fails 3 times in a row, is also deleted automatically. Blocking notifications in your browser settings stops them too.</p>
          </Section>

          <Section id="reports" title="Flood reports, the survey and &ldquo;Is this right?&rdquo;">
            <p>These are optional. We store an answer only when you press send.</p>
            <h3 className="font-semibold pt-1">Flood survey, &ldquo;Mark your spot&rdquo; and 3D-map reports</h3>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>What you tell us: a pin (from your phone&rsquo;s GPS if you tap the button, or placed by hand), whether water reached the spot and how deep, whether it entered the house, optional floor height, and when it was deepest. There is no free-text field, and we do not ask for a name or phone number.</li>
              <li>Your <strong>exact position stays private</strong>. It is stored on our server and used only to improve the flood map and forecast. It is never published.</li>
              <li>We also store an approximation rounded to about 100 m, the date, your language, and context from public sources at that moment: the nearest river gauge and its reading, and the nearest rain gauge.</li>
              <li>The public sees only counts, such as &ldquo;reports around Kelaniya&rdquo; or a district total, and only when <strong>3 or more</strong> reports fall in that area.</li>
              <li>A scrambled code that changes every day (made from your network address with a secret key) is stored with each report. It limits one person to about 10 reports a day and counts you once. We do not store your IP address itself, and the code cannot be traced back to you.</li>
            </ul>
            <h3 className="font-semibold pt-1">Optional photos on a report</h3>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Your browser shrinks the photo to a JPEG. Our server then removes all embedded metadata, including GPS location, before saving it. The only thing kept from the photo&rsquo;s metadata is its capture time and a yes/no on whether its location agreed with your pin.</li>
              <li>Photos are stored in a private Cloudflare R2 bucket, used only to check the report, and are not shown publicly.</li>
            </ul>
            <h3 className="font-semibold pt-1">&ldquo;Is this right?&rdquo; and street-water answers</h3>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>We store your answer, what the page showed at that moment, and only if you add them: what you see, where the water is, a short note, and a spot rounded to about 1 km (from your phone if you tap the button, or from the town you pick).</li>
              <li>Notes have links, phone numbers and email addresses removed before saving. They are read by the site owner, used only to improve notes and forecasts, and never shown publicly. An urgent-sounding report may trigger a private alert to the site owner.</li>
              <li>The same daily scrambled code as above is stored. Your name and IP address are not.</li>
              <li>We publish only totals, such as &ldquo;9 of 12 people near Hanwella this week said it matched&rdquo;, and only when at least 3 people answered. A nightly job turns answers into learned settings stored as counts and numbers only, with no notes, places or codes.</li>
            </ul>
          </Section>

          <Section id="social" title="Instagram, X and Facebook Page">
            <p>
              The site automatically posts public river and rain information, such as a river rising or a reservoir release, to its own accounts: Instagram{" "}
              <a className={link} href={IG_URL} target="_blank" rel="noreferrer me">@{IG_HANDLE}</a>
              {X_HANDLE ? (<>, X <a className={link} href={`https://x.com/${X_HANDLE}`} target="_blank" rel="noreferrer me">@{X_HANDLE}</a></>) : null}
              , and its Facebook Page. Posts use Meta&rsquo;s and X&rsquo;s official interfaces and contain only the public data shown on this site.
            </p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Our Meta app (&ldquo;waterlevels-poster&rdquo;) only publishes posts to our own Instagram account and Facebook Page. It does not read or collect data about followers, commenters, messages or anyone&rsquo;s Facebook or Instagram profile, and nobody is asked to log in to it.</li>
              <li>On X, the account may reply to people who write to it. Such a message (text cut to 300 characters, the sender&rsquo;s X id and username) is kept in a private table and emptied after 30 days.</li>
              <li>Each platform handles your own activity on it (follows, likes, comments) under its own privacy policy.</li>
            </ul>
          </Section>

          <Section id="third-parties" title="Other data sources and services">
            <ul className="list-disc pl-5 space-y-1.5">
              <li>River, rain, reservoir, news and weather data comes from public sources (for example the Irrigation Department, Mahaweli Authority, DMC, HMIS, RiverNet and news feeds). Our <strong>servers</strong> fetch them. Your browser does not contact those sites, so they do not learn about your visit.</li>
              <li>A few maps load from outside providers in your browser, which therefore see your IP address as any website would: the Colombo canals map loads OpenStreetMap tiles, and the unlisted 3D flood test map loads OpenFreeMap and Amazon-hosted elevation tiles. Google Analytics loads from Google.</li>
              <li>Fonts are served by us. Links to X, Instagram, Facebook, WhatsApp, Telegram and GitHub take you to those sites, under their own policies.</li>
              <li>On the 3D flood test map, &ldquo;Locate me&rdquo; can use an approximate city taken from your request headers by our host when your device gives no position. We do not store it or send it to any other service.</li>
            </ul>
          </Section>

          <Section id="hosting" title="Where data is kept">
            <ul className="list-disc pl-5 space-y-1.5">
              <li><strong>Vercel</strong> hosts the website and keeps ordinary server logs (such as request time and address) for operating the service.</li>
              <li><strong>Cloudflare</strong> holds our private database (D1: alert subscriptions, reports, answers, post history) and the private photo bucket (R2).</li>
              <li><strong>GitHub</strong> hosts our public code and runs our scheduled jobs. Its public &ldquo;data&rdquo; branch holds river readings and counts, never personal data.</li>
            </ul>
            <p>These providers may store data outside Sri Lanka.</p>
          </Section>

          <Section id="keep" title="How long we keep things">
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Alert subscriptions: until you turn alerts off or your browser drops the subscription.</li>
              <li>X replies: 30 days.</li>
              <li>Cookies: 24 hours or 1 year, as listed above. Local storage: until you clear it.</li>
              <li>Flood reports, survey answers, &ldquo;Is this right?&rdquo; answers and report photos: we keep them while they help improve the flood map and forecasts, because past floods are the evidence they are used for. They hold no name or account and cannot be linked back to you.</li>
            </ul>
          </Section>

          <Section id="choices" title="Your choices">
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Turn alerts off at any time in the alert settings.</li>
              <li>Clear cookies and site data in your browser to remove everything stored on your device.</li>
              <li>Block analytics with your browser or an extension. The site works without it.</li>
              <li>Decline location. Every feature that uses it also works by picking a place by hand.</li>
              <li>Because reports and answers carry no name, we cannot look up &ldquo;your&rdquo; rows by identity. If you sent a report or photo and want it removed, contact us (below) with the approximate place and date and we will delete it where we can find it.</li>
            </ul>
          </Section>

          <Section id="changes" title="Changes to this page">
            <p>If what we collect changes, we update this page and its date. The code is public at <a className={link} href={REPO} target="_blank" rel="noreferrer">github.com/shakee93/sl-water-levels</a>, so you can check how any of this works.</p>
          </Section>

          <Section id="contact" title="Contact">
            <p>
              For questions about privacy or to ask for a report to be removed, message us on Instagram{" "}
              <a className={link} href={IG_URL} target="_blank" rel="noreferrer me">@{IG_HANDLE}</a>
              {X_HANDLE ? (<> or X <a className={link} href={`https://x.com/${X_HANDLE}`} target="_blank" rel="noreferrer me">@{X_HANDLE}</a></>) : null}
              , write to <a className={link} href={OWNER.x} target="_blank" rel="noreferrer">the site owner on X</a>, or open an issue on{" "}
              <a className={link} href={`${REPO}/issues`} target="_blank" rel="noreferrer">GitHub</a>. Please do not post personal details publicly.
            </p>
          </Section>
        </div>
      </div>
    </main>
  );
}
