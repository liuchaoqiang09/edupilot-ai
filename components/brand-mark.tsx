"use client";

import { useId } from "react";

/** EduPilot 品牌标：自定义 EP + 明显玄幻动效 */
export function BrandMark({
  size = 34,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const face = `ep-face-${uid}`;
  const sheen = `ep-sheen-${uid}`;
  const aura = `ep-aura-${uid}`;

  return (
    <span
      className={`ws-brand-mark relative inline-grid shrink-0 place-items-center ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span className="ws-brand-mark__orbit" />
      <span className="ws-brand-mark__orbit ws-brand-mark__orbit--late" />
      <span className="ws-brand-mark__halo" />
      <span className="ws-brand-mark__core relative z-[1] overflow-hidden rounded-[10px]" style={{ width: size, height: size }}>
        <span className="ws-brand-mark__glow pointer-events-none absolute inset-0" />
        <svg viewBox="0 0 32 32" width={size} height={size} className="relative z-[1]" role="img">
          <title>EP</title>
          <defs>
            <linearGradient id={face} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#f7ffb0" />
              <stop offset="40%" stopColor="#d4f06a" />
              <stop offset="100%" stopColor="#7ec9b5" />
            </linearGradient>
            <linearGradient id={sheen} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#fff" stopOpacity="0" />
              <stop offset="45%" stopColor="#fff" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <radialGradient id={aura} cx="50%" cy="40%" r="60%">
              <stop offset="0%" stopColor="#fff" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#d4f06a" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="32" height="32" rx="10" fill={`url(#${face})`} />
          <rect width="32" height="32" rx="10" fill={`url(#${aura})`} />
          <rect className="ws-brand-mark__sheen-rect" width="32" height="32" rx="10" fill={`url(#${sheen})`} />
          <g className="ws-brand-mark__letters" fill="#0a2428">
            <path d="M5.8 6.6h10.2l-1.15 2.55H8.55v3.2h5.9l-.95 2.35H8.55v4.55h6.55l-1.15 2.55H5.8V6.6Z" />
            <path d="M17.1 6.6h4.9c4.15 0 6.7 2.35 6.7 5.95 0 3.55-2.55 5.9-6.75 5.9h-2.3v6.35h-2.55V6.6Zm2.55 2.5v6.85h2.05c2.2 0 3.55-1.15 3.55-3.45 0-2.25-1.35-3.4-3.55-3.4h-2.05Z" />
          </g>
          <g className="ws-brand-mark__stars" fill="#0a2428">
            <path d="M26.8 5.4 27.55 7.1 29.35 7.8 27.55 8.5 26.8 10.2 26.05 8.5 24.25 7.8 26.05 7.1Z" />
            <path d="M4.6 24.2 5.05 25.25 6.15 25.7 5.05 26.15 4.6 27.2 4.15 26.15 3.05 25.7 4.15 25.25Z" opacity="0.7" />
          </g>
        </svg>
      </span>
    </span>
  );
}

/** 侧栏 / 登录用字标：小号、有层次，不抢 Logo */
export function BrandWordmark({
  tone = "light",
  className = "",
}: {
  tone?: "light" | "dark";
  className?: string;
}) {
  const light = tone === "light";
  return (
    <span className={`ws-wordmark ${light ? "ws-wordmark--light" : "ws-wordmark--dark"} ${className}`}>
      <span className="ws-wordmark__name">EduPilot</span>
      <span className="ws-wordmark__ai" aria-hidden>
        AI
      </span>
    </span>
  );
}

export function BrandLockup({
  size = 34,
  tone = "light",
  className = "",
}: {
  size?: number;
  tone?: "light" | "dark";
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <BrandMark size={size} />
      <BrandWordmark tone={tone} />
    </span>
  );
}
