"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-xl border border-red-200 dark:border-red-900 bg-white dark:bg-slate-900 p-6 shadow-sm">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-red-100 dark:bg-red-950/60 px-2.5 py-1 text-xs font-medium text-red-700 dark:text-red-300 mb-3">
          <AlertTriangle className="size-3.5" />
          Something broke
        </div>
        <h1 className="text-lg font-semibold mb-2">Could not load this station</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
          The source ArcGIS service may be rate-limiting requests. Try again in a moment.
        </p>
        {error.message && (
          <pre className="text-[11px] font-mono bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-md p-2 overflow-auto max-h-32 mb-4 text-slate-600 dark:text-slate-400">
            {error.message}
          </pre>
        )}
        <button
          onClick={reset}
          className="inline-flex items-center gap-1.5 justify-center rounded-md bg-sky-600 hover:bg-sky-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition"
        >
          <RefreshCw className="size-3.5" />
          Try again
        </button>
      </div>
    </main>
  );
}
