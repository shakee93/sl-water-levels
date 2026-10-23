import type { MetadataRoute } from "next";
import { SITE } from "@/lib/seo";

// Public safety information: every search engine and answer engine is welcome, by name, so a
// crawler's own rules (and a host's default "block AI bots" switches) have an explicit yes to read.
// Search/answer crawlers fetch pages to quote them; training crawlers are allowed too because
// the point of the site is that the numbers and the 117 emergency line reach as many people as possible.
const BOTS = [
  // Search and answer engines
  "Googlebot", "Google-Extended", "GoogleOther", "Bingbot", "Applebot", "Applebot-Extended", "DuckDuckBot", "DuckAssistBot", "YandexBot", "Slurp",
  // OpenAI
  "GPTBot", "OAI-SearchBot", "ChatGPT-User",
  // Anthropic
  "ClaudeBot", "Claude-User", "Claude-SearchBot", "anthropic-ai",
  // Perplexity, Mistral, Cohere, You.com, Meta, Amazon, Common Crawl, Diffbot
  "PerplexityBot", "Perplexity-User", "MistralAI-User", "cohere-ai", "YouBot", "Meta-ExternalAgent", "Meta-ExternalFetcher", "FacebookBot", "Amazonbot", "CCBot", "Diffbot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: BOTS, allow: "/" },
      { userAgent: "*", allow: "/" },
    ],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
