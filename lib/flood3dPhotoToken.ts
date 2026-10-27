// The short-lived proof that a browser may attach photos to the report it just made (returned by POST /api/flood3d/report, checked by the photo route).
import { createHmac } from "node:crypto";

export function photoToken(reportId: string, createdMs: number): string {
  const key = process.env.FLOOD_REPORT_SALT || process.env.CLOUDFLARE_API_TOKEN || "";
  return createHmac("sha256", key).update(`f3dphoto|${reportId}|${createdMs}`).digest("hex").slice(0, 32);
}
