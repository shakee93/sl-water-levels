// One per-day code for a person, shared by both answer forms ("Is this right?" and "Did the streets get water?"), so the learning job
// counts someone who answers both once. Same key as the rate-limit hashes, a different label, rotates every Colombo day, 32 hex chars.
// The code is stored in the person_day column and is never returned, exported, logged or sent anywhere (see DOCS.md "Learning from feedback").
import { createHmac } from "node:crypto";

export function personDay(ip: string, day: string): string {
  const key = process.env.FLOOD_REPORT_SALT || process.env.CLOUDFLARE_API_TOKEN || "";
  return createHmac("sha256", key).update(`person|${day}|${ip}`).digest("hex").slice(0, 32);
}
