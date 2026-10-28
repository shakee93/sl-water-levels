// Shared by the full survey sheet (SurveyPanel.tsx) and the small "mark your spot" step in the "Is this right?" card
// (app/feedback/MarkSpot.tsx): the street-depth choices and the one POST to /api/flood3d/report, so both send the same thing.
export const LEVELS: [string, string, string][] = [["ankle", "Ankle", "about 10 cm / 4 in"], ["knee", "Knee", "about 45 cm / 1.5 ft"], ["waist", "Waist", "about 1 m / 3 ft"], ["chest", "Chest", "about 1.3 m / 4 ft"], ["head", "Above my head", "1.7 m / 5.5 ft or more"]];

export type PostResult = { state: "done"; area: { name: string; n: number } | null } | { state: "limit" } | { state: "error" };

/** POST a survey answer. `body` is the report without the survey flag; `?f3dtest` on the page marks it as a test row. */
export async function postSurveyReport(body: Record<string, unknown>): Promise<PostResult> {
  try {
    const r = await fetch("/api/flood3d/report", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ test: new URLSearchParams(location.search).has("f3dtest"), survey: true, ...body }),
    });
    if (r.status === 429) return { state: "limit" };
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) return { state: "error" };
    return { state: "done", area: j.area ?? null };
  } catch {
    return { state: "error" };
  }
}
