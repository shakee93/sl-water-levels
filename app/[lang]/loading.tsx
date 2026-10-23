// Shown the instant a link is tapped while the next page is still being prepared (the layout, header and bottom tabs
// stay in place). Same width and rhythm as the pages, plain grey blocks, no spinner.
export default function Loading() {
  const block = "rounded-xl bg-slate-200/70 dark:bg-slate-800/70 animate-pulse motion-reduce:animate-none";
  return (
    <main className="min-h-[70vh] bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900" aria-busy="true">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className={`${block} h-8 w-2/3 sm:w-1/3`} />
        <div className={`${block} mt-3 h-4 w-1/2 sm:w-1/4`} />
        <div className={`${block} mt-6 h-36 w-full`} />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className={`${block} h-28`} />
          <div className={`${block} h-28`} />
        </div>
        <div className={`${block} mt-4 h-56 w-full`} />
      </div>
    </main>
  );
}
