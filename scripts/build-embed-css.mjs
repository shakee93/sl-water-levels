// Builds public/embed.css: the Tailwind rules the static embed widgets use (river, town, right now, reservoirs, ticker), so those
// pages ship one small stylesheet and no JavaScript framework. Run after changing app/embed/views.tsx, lib/embedStyle.ts or
// app/TierPill.tsx (it also runs before `next build`): node scripts/build-embed-css.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const input = `@import "tailwindcss" source(none);
@source "../app/embed/views.tsx";
@source "../app/TierPill.tsx";
@source "../lib/embedStyle.ts";
@custom-variant dark (&:where(.dark, .dark *));
@theme inline { --font-sans: var(--font-geist-sans, ui-sans-serif), system-ui, "Noto Sans Sinhala", "Noto Sans Tamil", sans-serif; }
html { color-scheme: light; }
html.dark { color-scheme: dark; }
body { margin: 0; background: transparent; }
`;
mkdirSync("public", { recursive: true });
const res = await postcss([tailwind({ optimize: { minify: true } })]).process(input, { from: "scripts/embed.css" });
writeFileSync("public/embed.css", res.css);
console.log("public/embed.css", res.css.length, "bytes");
