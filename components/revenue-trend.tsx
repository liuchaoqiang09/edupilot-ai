"use client";

import { useState } from "react";

export type RevenuePoint = { label: string; amount: number };

export function RevenueTrend({ points }: { points: RevenuePoint[] }) {
  const [active, setActive] = useState<number | null>(null);
  const width = 640;
  const height = 220;
  const pad = { left: 46, right: 12, top: 16, bottom: 32 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const peak = niceMax(Math.max(...points.map((point) => point.amount), 0));
  const xAt = (index: number) => pad.left + (points.length <= 1 ? plotWidth / 2 : (index * plotWidth) / (points.length - 1));
  const yAt = (amount: number) => pad.top + (peak === 0 ? plotHeight : plotHeight - (amount / peak) * plotHeight);
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"} ${xAt(index).toFixed(1)} ${yAt(point.amount).toFixed(1)}`).join(" ");
  const area = `${line} L ${xAt(points.length - 1).toFixed(1)} ${(pad.top + plotHeight).toFixed(1)} L ${xAt(0).toFixed(1)} ${(pad.top + plotHeight).toFixed(1)} Z`;
  const ticks = peak === 0 ? [0] : [0, peak / 2, peak];
  const empty = points.every((point) => point.amount === 0);
  const hovered = active === null ? null : points[active];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" className="h-full w-full" role="img" aria-label="近 6 个月收入趋势">
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={yAt(tick)} y2={yAt(tick)} stroke="#e4e9e7" strokeWidth="1" />
              <text x={pad.left - 8} y={yAt(tick) + 4} textAnchor="end" fill="#74838b" fontSize="11">{axisMoney(tick)}</text>
            </g>
          ))}
          <defs>
            <linearGradient id="owner-revenue-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0f7a6c" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#0f7a6c" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="owner-revenue-stroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#2a9d8a" />
              <stop offset="100%" stopColor="#0f7a6c" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#owner-revenue-fill)" className="owner-trend-area" />
          <path d={line} fill="none" stroke="url(#owner-revenue-stroke)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" className="owner-trend-line" />
          {points.map((point, index) => (
            <g key={point.label}>
              <text x={xAt(index)} y={height - 8} textAnchor="middle" fill="#6b7d84" fontSize="11">{point.label}</text>
              <circle
                cx={xAt(index)}
                cy={yAt(point.amount)}
                r={active === index ? 6 : 4}
                fill={active === index ? "#2a9d8a" : "#0f7a6c"}
                className="owner-trend-dot"
                style={{ animationDelay: `${0.35 + index * 0.08}s` }}
              />
              <circle
                cx={xAt(index)}
                cy={yAt(point.amount)}
                r="14"
                fill="transparent"
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
              />
            </g>
          ))}
        </svg>
        {hovered && active !== null ? (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[130%] rounded-lg bg-[var(--navy)] px-2.5 py-1.5 text-[11px] font-bold text-white shadow-[0_8px_24px_rgba(24,42,53,.16)]"
            style={{ left: `${(xAt(active) / width) * 100}%`, top: `${(yAt(hovered.amount) / height) * 100}%` }}
          >
            {hovered.label} · {yuan(hovered.amount)}
          </div>
        ) : null}
      </div>
      {empty ? <p className="mt-2 text-center text-xs leading-6 text-[var(--muted)]">暂无收入数据</p> : null}
    </div>
  );
}

function yuan(amount: number) {
  return `¥ ${amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function axisMoney(value: number) {
  if (value >= 1000) {
    const thousands = value / 1000;
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}k`;
  }
  return String(Math.round(value));
}

function niceMax(value: number) {
  if (value <= 0) return 0;
  const power = 10 ** Math.floor(Math.log10(value));
  const scaled = value / power;
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return nice * power;
}
