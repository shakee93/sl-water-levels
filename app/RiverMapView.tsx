"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { MapModel, MapNode } from "@/lib/riverMap";
import { TIER_HEX } from "./tierUi";

// The drawing for RiverMap (server). Plain SVG: the river line, dashed links from dams, a pulse of
// flow from a releasing dam down to its gauges, gauges coloured by level, dam icons, labels.
// On a touch screen the first tap on a point opens a small card under the map (name, state, link);
// a second tap, a mouse click or Enter follows the link. Every point is a real <a>.

export type MapStrings = {
  aria: string;
  hint: string;
  gauge: string;
  reservoir: string;
  release: string;
  simplified: string;
  list: string;
  openGauge: string;
  openReservoir: string;
};

const RES_FILL: Record<NonNullable<MapNode["status"]>, string> = {
  spilling: "#f59e0b",
  releasing: "#0ea5e9",
  holding: "#10b981",
  nodata: "#cbd5e1",
};

const num1 = (n: number) => Math.round(n * 10) / 10;
const halo = "stroke-white dark:stroke-slate-900 [paint-order:stroke]";
const labelCls = `fill-slate-700 dark:fill-slate-200 ${halo}`;

export function RiverMapView({ model, strings, extras = {} }: { model: MapModel; strings: MapStrings; extras?: Record<string, React.ReactNode> }) {
  const [sel, setSel] = useState<string | null>(null);
  const wasSel = useRef<boolean | null>(null);
  const picked = model.nodes.find((n) => n.id === sel) ?? null;
  const interactive = model.nodes.filter((n) => n.href);
  const geo = model.geo;

  function onClick(e: React.MouseEvent, id: string) {
    const was = wasSel.current ?? true; // null = keyboard: the card is already open from focus
    wasSel.current = null;
    if (!was && window.matchMedia("(pointer: coarse)").matches) {
      e.preventDefault();
      setSel(id);
    }
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${model.w} ${model.h}`}
        className={`mx-auto block w-full ${geo ? (model.h > 340 ? "max-w-[440px]" : "max-w-[560px]") + " rounded-lg" : "max-w-[480px]"} h-auto select-none`}
        role="group"
        aria-label={strings.aria}
        style={{ fontSize: 10.5 }}
      >
        {geo && (
          <g aria-hidden>
            <rect width={model.w} height={model.h} className="fill-[#e3eef7] dark:fill-[#0b1522]" />
            {geo.land.map((d, i) => (
              <path key={i} d={d} strokeWidth={0.9} strokeLinejoin="round" className="fill-[#f6f5f1] stroke-[#b9c7d3] dark:fill-[#1a2433] dark:stroke-[#33465c]" />
            ))}
            {geo.context.map((d, i) => (
              <path key={i} d={d} fill="none" strokeWidth={0.9} strokeLinecap="round" strokeLinejoin="round" className="stroke-sky-300/70 dark:stroke-slate-600/80" />
            ))}
          </g>
        )}
        {geo?.lakes.map((l) => (
          <path key={l.id} d={l.d} strokeWidth={1.6} strokeLinejoin="round" aria-hidden stroke={l.status === "nodata" ? "#94a3b8" : RES_FILL[l.status]} className="fill-sky-200 dark:fill-sky-900" />
        ))}
        {/* river */}
        {model.lines.map((l) => (
          <g key={l.id} aria-hidden>
            <path
              d={l.d}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={geo ? (l.trib ? 1.6 : 2.6) : l.trib ? 3 : 4.5}
              className={geo ? "stroke-sky-500 dark:stroke-sky-400" : "stroke-sky-200 dark:stroke-sky-900"}
            />
          </g>
        ))}
        {/* links from a dam to the river */}
        {model.links.map((l) => (
          <path key={l.id} d={l.d} fill="none" strokeWidth={1.4} strokeDasharray="3 3" strokeLinecap="round" aria-hidden className={l.active ? "stroke-amber-500" : "stroke-slate-400 dark:stroke-slate-500"} />
        ))}
        {/* water on the move */}
        {model.flows.map((f) => (
          <path key={f.id} d={f.d} fill="none" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 10" aria-hidden className="rm-flow stroke-amber-500 dark:stroke-amber-400" />
        ))}

        {model.nodes.map((n) => (
          <Node key={n.id} n={n} selected={sel === n.id} strings={strings} onSelect={() => setSel(n.id)} onDown={() => (wasSel.current = sel === n.id)} onClick={(e) => onClick(e, n.id)} />
        ))}

        {geo && (
          <g aria-hidden className="fill-slate-500 dark:fill-slate-400" fontSize={8.5}>
            {/* north arrow */}
            <g transform={`translate(${geo.northX} 14)`}>
              <path d="M0 -9L4.5 5L0 2.5L-4.5 5Z" className="fill-slate-600 dark:fill-slate-300" />
              <text y="16" textAnchor="middle" fontWeight={600} className={halo} strokeWidth={2.5}>N</text>
            </g>
            {geo.scale && (
              <g transform={`translate(${geo.scale.x} ${geo.scale.y})`}>
                <path d={`M0 -4V0H${num1(geo.scale.px)}V-4`} fill="none" strokeWidth={1.4} className="stroke-slate-600 dark:stroke-slate-300" />
                <text x={num1(geo.scale.px) / 2} y={-7} textAnchor="middle" className={halo} strokeWidth={2.5}>{geo.scale.label}</text>
              </g>
            )}
            <text x={model.w - 4} y={model.h - 5} textAnchor="end" fontSize={7.5} className={halo} strokeWidth={2.5}>© OpenStreetMap contributors</text>
          </g>
        )}
      </svg>

      {/* legend + hint */}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="-6 -6 12 12" aria-hidden><circle r="4.5" fill="#64748b" className="stroke-white dark:stroke-slate-900" strokeWidth="1.5" /></svg>
          {strings.gauge}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="14" height="12" viewBox="-7 -6 14 12" aria-hidden><Tank fill="#10b981" /></svg>
          {strings.reservoir}
        </span>
        {model.flows.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden><path d="M1 6H17" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" strokeDasharray="1 5" /></svg>
            {strings.release}
          </span>
        )}
      </div>

      <div className="mt-2 min-h-16" aria-live="polite">
        {picked && picked.href && picked.kind !== "town" ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="font-medium truncate">{picked.name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{picked.detail}</p>
              {extras[picked.id] && <div className="mt-1">{extras[picked.id]}</div>}
            </div>
            <Link href={picked.href} className="inline-flex shrink-0 items-center gap-1 min-h-11 text-sky-700 dark:text-sky-300 font-medium hover:underline">
              {picked.kind === "gauge" ? strings.openGauge : strings.openReservoir}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400">{strings.hint}{geo ? "" : ` ${strings.simplified}`}</p>
        )}
      </div>

      {/* text version for screen readers: the order along the river and each state */}
      <div className="sr-only">
        <p>{strings.list}</p>
        <ul>
          {interactive.map((n) => (
            <li key={n.id}>{n.name}: {n.detail}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Tank({ fill }: { fill: string }) {
  // a small lake, not a box
  return (
    <>
      <path d="M-7 0.5C-7.5-4-2-6.5 2.5-5.5 7-5 8.5-1 6.5 3 4.5 6.5-3 6.8-5.8 4-6.8 2.6-7 1.4-7 0.5Z" fill={fill} className="stroke-white dark:stroke-slate-900" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M-4 0.4q2-2 4 0t4 0" fill="none" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" opacity="0.9" />
    </>
  );
}

function Node({
  n, selected, strings, onSelect, onDown, onClick,
}: {
  n: MapNode;
  selected: boolean;
  strings: MapStrings;
  onSelect: () => void;
  onDown: () => void;
  onClick: (e: React.MouseEvent) => void;
}) {
  const label = n.label && (
    <text x={n.label.x} y={n.label.y} textAnchor={n.label.anchor} aria-hidden strokeWidth={3} strokeLinejoin="round" className={n.kind === "sea" ? `fill-sky-700 dark:fill-sky-300 italic ${halo}` : n.kind === "town" ? `fill-slate-500 dark:fill-slate-400 ${halo}` : labelCls} fontWeight={n.kind === "gauge" || n.highlight || n.focus ? 600 : 400}>
      {n.label.text}
      {n.label.sub && (
        <tspan x={n.label.x} dy={12} className="fill-slate-500 dark:fill-slate-400" fontWeight={400}>{n.label.sub}</tspan>
      )}
    </text>
  );

  if (n.kind === "sea") {
    return (
      <g aria-hidden>
        <path d={`M${n.x - 7} ${n.y}q3.5-4 7 0t7 0M${n.x - 7} ${n.y + 4}q3.5-4 7 0t7 0`} fill="none" strokeWidth="1.4" strokeLinecap="round" className="stroke-sky-500 dark:stroke-sky-400" />
        {label}
      </g>
    );
  }
  if (n.kind === "town") {
    return (
      <g aria-hidden>
        <circle cx={n.x} cy={n.y} r={2.4} fill="none" strokeWidth="1.2" className="stroke-slate-400 dark:stroke-slate-500" />
        {label}
      </g>
    );
  }

  const aria = `${n.name}, ${n.detail}. ${n.kind === "gauge" ? strings.openGauge : strings.openReservoir}`;
  return (
    <g>
      {label}
      <Link href={n.href!} aria-label={aria} className="outline-none group cursor-pointer" onFocus={onSelect} onPointerDown={onDown} onClick={onClick}>
        <title>{`${n.name} · ${n.detail}`}</title>
        {/* 32 px touch target */}
        <circle cx={n.x} cy={n.y} r={16} fill="transparent" />
        {(selected || n.highlight || n.focus) && <circle cx={n.x} cy={n.y} r={n.kind === "gauge" ? 9 : 11} fill="none" strokeWidth="1.6" className="stroke-sky-600 dark:stroke-sky-300" />}
        <circle cx={n.x} cy={n.y} r={13} fill="none" strokeWidth="2" className="stroke-sky-600 dark:stroke-sky-300 opacity-0 group-focus-visible:opacity-100" />
        {n.kind === "gauge" ? (
          <circle cx={n.x} cy={n.y} r={n.tier === "normal" || n.tier === "none" || n.tier === "stale" ? 5 : 6} fill={TIER_HEX[n.tier ?? "none"]} strokeWidth="1.6" className="stroke-white dark:stroke-slate-900" />
        ) : (
          <g transform={`translate(${n.x} ${n.y})`}>
            {n.active && <circle r={11} fill="none" strokeWidth="1.4" className="rm-ring stroke-amber-500 dark:stroke-amber-400" />}
            <Tank fill={RES_FILL[n.status ?? "nodata"]} />
          </g>
        )}
      </Link>
    </g>
  );
}
