import { notFound } from "next/navigation";

// proxy.ts rewrites every address that does not exist here, so the answer is a real 404. It must throw straight
// away: the other pages stream, and a notFound() after the first byte can no longer change the status code.
export const dynamic = "force-dynamic";

export default function PageNotFound() {
  notFound();
}
