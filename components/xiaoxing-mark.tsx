"use client";

import { useId } from "react";

/** 小星活体标记：呼吸光环 + 闪星 + 微轨 */
export function XiaoxingMark({
  size = 32,
  busy = false,
  className = "",
}: {
  size?: number;
  busy?: boolean;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const orb = `xx-orb-${uid}`;

  return (
    <span
      className={`xx-mark relative inline-grid shrink-0 place-items-center ${busy ? "xx-mark--busy" : ""} ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span className="xx-mark__ring xx-mark__ring--a" />
      <span className="xx-mark__ring xx-mark__ring--b" />
      <span className="xx-mark__core relative z-[1] grid place-items-center rounded-full">
        <svg viewBox="0 0 32 32" width={Math.round(size * 0.92)} height={Math.round(size * 0.92)} className="overflow-visible">
          <defs>
            <radialGradient id={orb} cx="35%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#f3ffb0" />
              <stop offset="55%" stopColor="#d4f06a" />
              <stop offset="100%" stopColor="#9fcd3a" />
            </radialGradient>
          </defs>
          <circle cx="16" cy="16" r="15" fill={`url(#${orb})`} />
          <g className="xx-mark__orbit" fill="#123338">
            <circle cx="16" cy="3.2" r="1.15" />
            <circle cx="28.2" cy="18.5" r="0.9" opacity="0.7" />
            <circle cx="7" cy="24.5" r="0.75" opacity="0.55" />
          </g>
          <g className="xx-mark__star" fill="#123338">
            <path d="M16 5.2 18.15 12.1 25.4 14.2 18.15 16.3 16 23.2 13.85 16.3 6.6 14.2 13.85 12.1Z" />
          </g>
        </svg>
      </span>
    </span>
  );
}
