import type { MetadataRoute } from "next";

// Lets people add the site to their Home Screen and open "Your places" in one tap. Pairs with public/sw.js.
// One manifest for all languages: start_url "/" follows the visitor's saved language (proxy.ts).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sri Lanka Water Levels",
    short_name: "Water Levels",
    description: "Live river levels and flood estimates for your places in Sri Lanka.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0c4a6e",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
