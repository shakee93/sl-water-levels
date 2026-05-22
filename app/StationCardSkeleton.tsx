export function StationCardSkeleton() {
  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden animate-pulse">
      <div className="p-4 sm:p-6 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2 flex-1">
            <div className="h-5 sm:h-6 w-40 bg-slate-200 dark:bg-slate-800 rounded" />
            <div className="h-3 w-24 bg-slate-200 dark:bg-slate-800 rounded" />
          </div>
          <div className="h-6 w-24 bg-slate-200 dark:bg-slate-800 rounded-full" />
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-100 dark:bg-slate-800">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white dark:bg-slate-900 px-3 py-3 sm:px-4 sm:py-4 space-y-2">
            <div className="h-2.5 w-12 bg-slate-200 dark:bg-slate-800 rounded" />
            <div className="h-5 w-16 bg-slate-200 dark:bg-slate-800 rounded" />
          </div>
        ))}
      </div>
      <div className="p-4 sm:p-6">
        <div className="h-72 w-full bg-slate-100 dark:bg-slate-800/60 rounded-md" />
      </div>
    </section>
  );
}
