// node scripts/news.test.mts : Flood-news classification (sample headlines, incl. the 26 Oct 2026 items) and the snippet limits.
// @ts-expect-error node strip-types needs explicit extensions
import { classifyNews } from "../lib/newsClassify.ts";
// @ts-expect-error explicit .ts extension for node
import { snippetOf, SNIPPET_MAX_WORDS, plainText } from "../lib/newsText.ts";

// @ts-expect-error explicit .ts extension for node
import { cleanImageUrl, feedImage, wpImage, ogImage, NEWS_IMAGE_HOSTS } from "../lib/newsImage.ts";
import { readFileSync } from "node:fs";

let ok = 0;
let bad = 0;
const pass = (cond: boolean, label: string, extra = "") => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${cond ? "" : `  ${extra}`}`);
};
const cls = (title: string, want: string | null, desc = "") => {
  const v = classifyNews({ title, desc });
  const got = v.kind === "yes" ? v.tag : v.kind === "borderline" ? `?${v.tag}` : null;
  pass(got === want, `classify: ${title}`, `got ${got} want ${want}`);
};

// the 26 Oct 2026 items
cls("Heavy rain warning issued for six provinces as Bay of Bengal depression intensifies", "Warning");
cls("Spill gates of several reservoirs opened amid heavy rainfall in Sri Lanka", "Reservoir");
cls("Cyclone developing in Bay of Bengal: What Sri Lanka can expect in coming days", "Cyclone");
cls("Cyclonic storm ‘Arnab’ intensifies, fishermen warned of strong winds and rough seas", "Cyclone");
// the other items in the same feed are not flood news
cls("Discover the World Strengthens Sri Lanka Presence with Appointment of Tuan Kitchilan", null);
cls("US Navy ship USS Canberra arrives in Colombo for second visit this year", null);
cls("Dollar Rate today: Rupee appreciates slightly against USD", null);
cls("Litro to distribute 700,000 gas cylinders islandwide by tomorrow", null);
cls("Norochcholai Power Plant’s second generator shut down for maintenance", null);
cls("Five injured in bus-tipper collision in Ahangama", null);
cls("Over 5,000 MT sulfuric acid released into environment annually, CEJ warns", null);
cls("Sajith calls for five key safeguards in proposed Anti-Terrorism and Organised Crime laws", null);
// sport, politics, business, entertainment are excluded
cls("Sri Lanka beat India by 5 wickets in rain-affected T20 match", null);
cls("Cricket: Rain delays start of second Test in Galle", null);
cls("Budget 2027 to cut flood of imported vehicles, says minister", null);
cls("Brazil's left-wing President Lula wins historic fourth term", null);
cls("Medical emergency: Sri Lanka evacuates 40 Iranian sailors off Galle", null);
cls("Cabinet approves Rs. 15.07 Bn revised plan to complete Kolonnawa flood control project", null);
cls("Landslide warnings issued for 5 districts", "Landslide");
cls("Minor flooding likely in Kalu Ganga Basin within next 24 hours", "River");
// foreign floods are not ours
cls("Floods kill 20 in northern India as river breaches banks", null);
cls("Typhoon hits Philippines, thousands evacuated", null);
// relevant items of every tag
cls("Flood warning for Kelani river as water level rises at Hanwella", "River");
cls("Landslide warning issued for Kegalle and Ratnapura districts", "Landslide");
cls("Railway line between Colombo and Kandy blocked after landslide", "Closure");
cls("Main road to Ratnapura closed due to flooding", "Closure");
cls("Several roads submerged in Gampaha as heavy rain continues", "Closure");
cls("Residents evacuated from low-lying areas of Kolonnawa", "Warning");
cls("DMC urges public to be vigilant as rains intensify", "Warning");
cls("Heavy rain expected in Western and Sabaragamuwa provinces, says Met Department", "Rain");
cls("Showers expected in several areas after 2 pm in Sri Lanka", "Rain");
cls("Two spill gates of Upper Kotmale reservoir opened", "Reservoir");
cls("Schools in flood-hit areas closed on Tuesday", "Closure");
// borderline: a bare weather word, no Sri Lankan marker, nothing stronger
cls("Showers expected this evening", "?Rain");
// description-only hazard is borderline (the model, if configured, decides)
cls("Weather outlook for the week", "?Rain");
cls("Weather outlook for the week", "Rain", "Floods and landslides are possible in the hill country.");

// snippet: first sentence, 20 words at most, never the full article
const long = "The spill gates of several reservoirs across Sri Lanka have been opened due to the prevailing heavy rainfall, with residents living downstream urged to remain vigilant about rising water.";
const s1 = snippetOf(long, "Spill gates opened");
pass(!!s1 && s1.split(" ").length <= SNIPPET_MAX_WORDS + 0 && s1.endsWith("…"), "snippet: long sentence cut at 20 words with an ellipsis", String(s1));
const s2 = snippetOf("Dams are full. Residents are advised to stay alert. More rain is coming.", "Dams full");
pass(s2 === "Dams are full.", "snippet: only the first sentence", String(s2));
const s3 = snippetOf("Sri Lanka’s Department of Meteorology has issued an amber advisory for heavy rain after a depression over the Bay of Continue Reading The post Heavy rain warning appeared first on Newswire.", "Heavy rain warning");
pass(!!s3 && !/Continue Reading|appeared first/.test(s3) && s3.endsWith("…") && s3.split(" ").length <= SNIPPET_MAX_WORDS, "snippet: feed boilerplate removed, truncated excerpt gets an ellipsis", String(s3));
pass(snippetOf("Heavy rain warning issued for six provinces", "Heavy rain warning issued for six provinces") === null, "snippet: a description that repeats the headline is dropped");
pass(snippetOf("", "x") === null, "snippet: empty description gives none");
const words = (x: string | null) => (x ?? "").replace(/…$/, "").split(" ").filter(Boolean).length;
pass(words(snippetOf("word ".repeat(200).trim() + ".", "t")) <= SNIPPET_MAX_WORDS, "snippet: never more than 20 words, even with no sentence end");
pass(plainText("<p>Sri Lanka&#8217;s &amp; <b>rain</b></p>") === "Sri Lanka’s & rain", "plainText: tags stripped, entities decoded");

// ---- cover thumbnails (owner decision 15 Nov 2026): extraction per source, https only, junk dropped, missing image
const NW = "https://www.newswire.lk/wp-content/uploads/2026/11/Zafran-News-6.jpeg";
const DM = "https://bmkltsly13vb.compat.objectstorage.ap-singapore-1.oraclecloud.com/cdn.sg.dailymirror.lk/assets/uploads/image_2c3106dabe.jpg";
const AD = "https://media.adaderanaenglish.lk/articles/251698/MediaFile_20261115_091424_660.jpg";
// Newswire RSS: first <img> of the description (real shape, CDATA)
const nwItem = `<item><title>T</title><description><![CDATA[<p><img width="640" height="400" src="${NW}" class="wp-post-image" alt="" srcset="${NW} 640w" /></p><p>Text</p>]]></description></item>`;
pass(feedImage(nwItem) === NW, "image: Newswire feed, first <img> of the description");
// Newswire: no image in the description, one in content:encoded
pass(feedImage(`<item><description><![CDATA[<p>No picture</p>]]></description><content:encoded><![CDATA[<p><img src="${NW}" width="640" height="400"/></p>]]></content:encoded></item>`) === NW, "image: Newswire feed, falls back to content:encoded");
// Daily Mirror: <image><url> (and single-quoted <img>)
pass(feedImage(`<item><description><![CDATA[Text <img src='${DM}' />]]></description><image>\n<url>${DM}</url>\n</image></item>`) === DM, "image: Daily Mirror feed, <image><url>");
pass(feedImage(`<item><description><![CDATA[Text <img src='${DM}' />]]></description></item>`) === DM, "image: Daily Mirror feed, single-quoted <img> in the description");
// enclosure / media:content, and an enclosure that is not an image is skipped
pass(feedImage(`<item><enclosure url="${NW}" type="image/jpeg" length="1"/></item>`) === NW, "image: enclosure");
pass(feedImage(`<item><media:content url="${NW}" medium="image" width="640" height="400"/></item>`) === NW, "image: media:content");
pass(feedImage(`<item><enclosure url="${NW}" type="audio/mpeg" length="1"/></item>`) === null, "image: a non-image enclosure is ignored");
// Ada Derana: feed has none (a real item), the story page has og:image
pass(feedImage("<item><title>Thundershowers</title><link>https://adaderana.lk/news/251698</link><description>Thundershowers</description></item>") === null, "image: Ada Derana feed item has none (missing image gives null)");
pass(ogImage(`<head><meta property="og:image" content="${AD}"/><meta property="og:image:width" content="1280"/><meta name="twitter:image" content="${AD}"/></head>`) === AD, "image: Ada Derana story page og:image");
pass(ogImage(`<head><meta name="twitter:image" content="${AD}"/></head>`) === AD, "image: story page falls back to twitter:image");
pass(ogImage("<head><title>x</title></head>") === null, "image: story page without og:image gives null");
// Newswire WordPress API: _embed=wp:featuredmedia
const wpPost = { _embedded: { "wp:featuredmedia": [{ source_url: NW, media_details: { width: 1600, height: 1130, sizes: { medium: { source_url: "https://www.newswire.lk/wp-content/uploads/2026/11/Zafran-News-6-425x300.jpeg", width: 425, height: 300 } } } }] } };
pass(wpImage(wpPost) === "https://www.newswire.lk/wp-content/uploads/2026/11/Zafran-News-6-425x300.jpeg", "image: WordPress API prefers the medium size");
pass(wpImage({ _embedded: { "wp:featuredmedia": [{ source_url: NW }] } }) === NW, "image: WordPress API falls back to the original file");
pass(wpImage({ _embedded: { "wp:featuredmedia": [{ code: "rest_forbidden" }] } }) === null && wpImage({}) === null && wpImage(null) === null, "image: WordPress post with no featured media gives null");
// https only, listed hosts only
pass(cleanImageUrl(NW.replace("https:", "http:")) === null, "image: http is rejected");
pass(cleanImageUrl("data:image/png;base64,iVBORw0KGgo=") === null, "image: data: is rejected");
pass(cleanImageUrl("//www.newswire.lk/wp-content/uploads/a.jpg") === null, "image: protocol-relative is rejected");
pass(cleanImageUrl("https://evil.example/wp-content/uploads/a.jpg") === null, "image: an unlisted host is rejected");
pass(cleanImageUrl("https://www.newswire.lk.evil.example/wp-content/uploads/a.jpg") === null, "image: a look-alike host is rejected");
pass(cleanImageUrl("https://www.newswire.lk/other/a.jpg") === null, "image: a listed host outside its image path is rejected");
pass(cleanImageUrl(NW + "?x=1") === null, "image: a query string is rejected (remotePatterns has none)");
// tracking pixels and tiny icons
pass(cleanImageUrl("https://www.newswire.lk/wp-content/uploads/2026/11/pixel.png") === null, "image: tracking pixel by name is rejected");
pass(cleanImageUrl("https://www.newswire.lk/wp-content/uploads/2026/11/logo-white.png") === null, "image: logo is rejected");
pass(cleanImageUrl(NW, 1, 1) === null && cleanImageUrl(NW, 64, 64) === null, "image: tiny declared size is rejected");
pass(cleanImageUrl(NW, 640, 400) === NW && cleanImageUrl(NW) === NW, "image: a normal picture passes");
pass(feedImage(`<item><description><![CDATA[<img src="https://www.newswire.lk/wp-content/uploads/2026/11/pixel.png" width="1" height="1"/><img src="${NW}" width="640" height="400"/>]]></description></item>`) === NW, "image: a pixel before the real picture is skipped");
pass(feedImage("<item><description>no image at all</description></item>") === null, "image: item with no image gives null");
// next.config.ts opens exactly the hosts the extractor accepts
const cfg = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
pass(NEWS_IMAGE_HOSTS.every((h: { hostname: string; pathPrefix: string }) => cfg.includes(`hostname: "${h.hostname}", pathname: "${h.pathPrefix}**"`)), "image: every listed host and path is in next.config.ts remotePatterns");

console.log(`\n${ok} passed, ${bad} failed`);
if (bad) process.exit(1);
