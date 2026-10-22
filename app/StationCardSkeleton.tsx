export function VerdictSkeleton() {
  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-4 sm:p-5 animate-pulse">
      <div className="h-7 w-44 bg-slate-200 dark:bg-slate-800 rounded" />
      <div className="mt-3 h-4 w-32 bg-slate-200 dark:bg-slate-800 rounded" />
      <div className="mt-2 h-4 w-56 bg-slate-200 dark:bg-slate-800 rounded" />
    </section>
  );
}

export function StationCardSkeleton() {
  return (
    <section className="mt-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden animate-pulse">
      <div className="p-4 sm:p-6 flex items-center justify-between">
        <div className="h-6 w-32 bg-slate-200 dark:bg-slate-800 rounded" />
        <div className="h-11 w-36 bg-slate-200 dark:bg-slate-800 rounded-lg" />
      </div>
      <div className="px-4 sm:px-6 pb-6">
        <div className="h-[22rem] sm:h-80 w-full bg-slate-100 dark:bg-slate-800/60 rounded-md" />
      </div>
    </section>
  );
}
