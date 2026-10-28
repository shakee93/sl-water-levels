// "Flooded where you are? Tell us" at the top of town and gauge pages (only where the flood map covers the place): visitors above the
// fold did not know there is a survey. It jumps to the "Is this right?" card and opens its "Mark your spot" step (#mark-spot, MarkSpot.tsx).
import { Flag } from "lucide-react";

export function SpotNudge({ label }: { label: string }) {
  return (
    <a href="#mark-spot" data-umami-event="spot_nudge" className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-full border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200 dark:hover:bg-sky-900/50">
      <Flag className="size-4" aria-hidden /> {label}
    </a>
  );
}
