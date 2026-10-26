// node scripts/news.test.mts : Flood-news classification (sample headlines, incl. the 26 Oct 2026 items) and the snippet limits.
// @ts-expect-error node strip-types needs explicit extensions
import { classifyNews } from "../lib/newsClassify.ts";
// @ts-expect-error explicit .ts extension for node
import { snippetOf, SNIPPET_MAX_WORDS, plainText } from "../lib/newsText.ts";

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

console.log(`\n${ok} passed, ${bad} failed`);
if (bad) process.exit(1);
