"use client";

// One "Share" button for gauge, town, river and home pages. On a phone that can share files it hands the story picture, the text and the
// link to the phone's own share sheet (Instagram / WhatsApp / Facebook stories appear there). Everywhere else it opens a small sheet:
// the picture (Story or Square), WhatsApp, Facebook, X, Telegram, Copy link, Download image. The picture comes from /api/story (our own
// server, CDN-cached 5 minutes); nothing personal is ever added to it.
import { useEffect, useRef, useState } from "react";
import { Check, Copy, Download, MessageCircle, Send, Share2, X as XIcon } from "lucide-react";
import { useI18n } from "./LocaleProvider";
import { trackEvent } from "@/lib/umami";
import { storyPath, timeBucket, type StoryFormat, type StoryKind } from "@/lib/story/url";

const ring =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";
const iconBtn =
  "inline-flex items-center justify-center gap-1.5 h-11 sm:h-9 min-w-11 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium text-slate-700 dark:text-slate-200 shadow-sm hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors";
const action =
  "flex min-h-12 items-center gap-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 px-3 text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800";

export type StoryRef = { kind: StoryKind; slug: string };

/** Can this browser hand a picture file to the phone's share sheet? */
function canShareFiles(): boolean {
  try {
    if (typeof navigator === "undefined" || typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false;
    return navigator.canShare({ files: [new File([new Uint8Array(1)], "a.png", { type: "image/png" })] });
  } catch {
    return false;
  }
}

export function ShareControl({ href, name, text, story, iconOnlyOnMobile = true }: { href: string; name: string; text: string; story: StoryRef; iconOnlyOnMobile?: boolean }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<Exclude<StoryFormat, "og">>("story");
  const [copied, setCopied] = useState(false);
  const [imgState, setImgState] = useState<"loading" | "ok" | "failed">("loading");
  const closeRef = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const prefetched = useRef<Promise<Blob> | null>(null);

  const pageUrl = () => window.location.origin + href;
  const imgPath = (f: StoryFormat) => storyPath(story.kind, story.slug, { format: f, lang, t: timeBucket() });
  const fullText = () => `${text} ${t("share.liveWord")} ${pageUrl()}`;

  // the picture is fetched when the finger goes down, so it is usually there by the time the tap completes (share() needs the tap's permission)
  function warm() {
    if (prefetched.current || !canShareFiles()) return;
    prefetched.current = fetch(imgPath("story")).then((r) => {
      if (!r.ok) throw new Error("image");
      return r.blob();
    });
    prefetched.current.catch(() => (prefetched.current = null));
  }

  async function onShare() {
    if (canShareFiles()) {
      try {
        const blob = await (prefetched.current ?? (warm(), prefetched.current!));
        const file = new File([blob], `waterlevels-${story.slug}.png`, { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], text: `${text} ${t("share.liveWord")}`, url: pageUrl() });
          trackEvent("story_share", { kind: story.kind, format: "story", method: "share" });
          return;
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        prefetched.current = null;
      }
    }
    setImgState("loading");
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      trigger.current?.focus();
    };
  }, [open]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(pageUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      trackEvent("story_share", { kind: story.kind, format, method: "copy" });
    } catch {
      /* clipboard blocked */
    }
  }

  const u = () => encodeURIComponent(pageUrl());
  const links: { key: string; label: string; href: string; icon: React.ReactNode }[] = open
    ? [
        { key: "whatsapp", label: t("verdict.whatsapp"), href: `https://wa.me/?text=${encodeURIComponent(fullText())}`, icon: <MessageCircle className="size-5" aria-hidden /> },
        { key: "facebook", label: t("share.facebook"), href: `https://www.facebook.com/sharer/sharer.php?u=${u()}`, icon: <span className="grid size-5 place-items-center rounded-full bg-[#1877f2] text-[13px] font-bold leading-none text-white" aria-hidden>f</span> },
        { key: "x", label: t("share.x"), href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${u()}`, icon: <span className="grid size-5 place-items-center rounded bg-black text-[12px] font-bold leading-none text-white" aria-hidden>X</span> },
        { key: "telegram", label: t("share.telegram"), href: `https://t.me/share/url?url=${u()}&text=${encodeURIComponent(text)}`, icon: <Send className="size-5" aria-hidden /> },
      ]
    : [];

  return (
    <>
      <button ref={trigger} type="button" onPointerDown={warm} onClick={onShare} aria-haspopup="dialog" aria-expanded={open} data-share-button className={`${iconBtn} ${ring}`}>
        <Share2 className="size-5" aria-hidden />
        <span className={iconOnlyOnMobile ? "hidden sm:inline" : ""}>{t("verdict.share")}</span>
        {iconOnlyOnMobile && <span className="sm:hidden sr-only">{t("verdict.share")}</span>}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
          <div className="absolute inset-0 bg-slate-950/50" onClick={() => setOpen(false)} aria-hidden />
          <div role="dialog" aria-modal="true" aria-label={t("share.sheetTitle", { name })} data-share-sheet className="relative w-full max-w-md max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50 min-w-0 break-words">{t("share.sheetTitle", { name })}</h2>
              <button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label={t("share.close")} className={`-mr-1 -mt-1 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 ${ring}`}>
                <XIcon className="size-5" aria-hidden />
              </button>
            </div>

            <div role="radiogroup" aria-label={t("share.imageSize")} className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
              {(["story", "square"] as const).map((f) => (
                <button key={f} type="button" role="radio" aria-checked={format === f} onClick={() => { setFormat(f); setImgState("loading"); }} className={`min-h-11 rounded-md px-2 text-sm font-medium ${ring} ${format === f ? "bg-white dark:bg-slate-900 shadow-sm text-slate-900 dark:text-slate-50" : "text-slate-600 dark:text-slate-300"}`}>
                  {t(f === "story" ? "share.story" : "share.square")}
                  <span className="block text-[11px] font-normal text-slate-500 dark:text-slate-400 leading-tight">{t(f === "story" ? "share.storyHint" : "share.squareHint")}</span>
                </button>
              ))}
            </div>

            <div className="mt-3 flex justify-center rounded-lg bg-slate-100 dark:bg-slate-800 p-2">
              <div className="relative" style={{ aspectRatio: format === "story" ? "9 / 16" : "1 / 1", height: format === "story" ? "min(46dvh, 360px)" : "min(36dvh, 280px)" }}>
                {imgState === "loading" && <p className="absolute inset-0 grid place-items-center text-xs text-slate-500 dark:text-slate-400" role="status">{t("share.preparing")}</p>}
                {imgState === "failed" && <p className="absolute inset-0 grid place-items-center p-3 text-center text-xs text-slate-600 dark:text-slate-300">{t("share.imageFailed")}</p>}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img key={format} src={imgPath(format)} alt={t("share.imageAlt")} width={format === "story" ? 1080 : 1080} height={format === "story" ? 1920 : 1080} onLoad={() => setImgState("ok")} onError={() => setImgState("failed")} className={`h-full w-full rounded-md object-contain ${imgState === "ok" ? "" : "opacity-0"}`} />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <a href={imgPath(format)} download={`waterlevels-${story.slug}-${format}.png`} onClick={() => trackEvent("story_share", { kind: story.kind, format, method: "download" })} className={`${action} col-span-2 justify-center bg-sky-600 text-white border-sky-600 hover:bg-sky-700 dark:bg-sky-600 ${ring}`} style={{ color: "#fff" }}>
                <Download className="size-5" aria-hidden /> {t("share.download")}
              </a>
              {links.map((l) => (
                <a key={l.key} href={l.href} target="_blank" rel="noopener noreferrer" onClick={() => trackEvent("story_share", { kind: story.kind, format, method: l.key })} className={`${action} ${ring}`}>
                  {l.icon} {l.label}
                </a>
              ))}
              <button type="button" onClick={copy} className={`${action} col-span-2 ${ring}`}>
                {copied ? <Check className="size-5 text-emerald-600" aria-hidden /> : <Copy className="size-5" aria-hidden />}
                {copied ? t("verdict.copied") : t("share.copyLink")}
              </button>
            </div>
            <span className="sr-only" aria-live="polite">{copied ? t("verdict.copiedLive") : ""}</span>
          </div>
        </div>
      )}
    </>
  );
}
