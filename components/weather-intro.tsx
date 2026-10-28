"use client";

import { useEffect, useState } from "react";
import {
  clearWeatherIntroPending,
  peekWeatherIntroPending,
  resolveWeatherIntroKind,
  weatherIntroLabel,
  type WeatherIntroKind,
} from "@/lib/weather-condition";
import { isWeatherIntroEnabled } from "@/lib/weather-pref";

const HOLD_MS = 1000;
const FADE_MS = 2000;

type Phase = "off" | "hold" | "fade";

/**
 * 登录后迎宾层：晴/阴/雨/夜间，满显约 1s，再渐变淡出 2s。
 * 标记在真正开播时才清掉，避免 Strict Mode 双挂载把第一次播放取消后标记已空。
 */
export function WeatherIntro() {
  const [phase, setPhase] = useState<Phase>("off");
  const [kind, setKind] = useState<WeatherIntroKind | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!peekWeatherIntroPending()) return;
    if (!isWeatherIntroEnabled()) {
      clearWeatherIntroPending();
      return;
    }

    const reduce =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let cancelled = false;
    let holdTimer = 0;
    let fadeTimer = 0;

    void (async () => {
      const next = await resolveWeatherIntroKind();
      if (cancelled) return;
      // 开播瞬间再清：Strict Mode 第一次被 cancel 时标记仍在，二次 mount 还能播。
      clearWeatherIntroPending();
      setKind(next);
      setPhase("hold");

      const hold = reduce ? 400 : HOLD_MS;
      const fade = reduce ? 500 : FADE_MS;

      holdTimer = window.setTimeout(() => {
        if (cancelled) return;
        setPhase("fade");
        fadeTimer = window.setTimeout(() => {
          if (cancelled) return;
          setPhase("off");
          setKind(null);
        }, fade);
      }, hold);
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(holdTimer);
      window.clearTimeout(fadeTimer);
    };
  }, []);

  if (phase === "off" || !kind) return null;

  return (
    <div
      className={`wx-intro wx-intro--${kind}${phase === "fade" ? " wx-intro--fade" : ""}`}
      aria-hidden="true"
    >
      <div className="wx-intro__veil" />
      {kind === "clear" ? (
        <>
          <span className="wx-intro__sun" />
          <span className="wx-intro__orb wx-intro__orb--a" />
          <span className="wx-intro__orb wx-intro__orb--b" />
        </>
      ) : null}
      {kind === "cloudy" ? (
        <>
          <span className="wx-intro__cloud wx-intro__cloud--a" />
          <span className="wx-intro__cloud wx-intro__cloud--b" />
          <span className="wx-intro__cloud wx-intro__cloud--c" />
        </>
      ) : null}
      {kind === "rain" ? (
        <>
          <span className="wx-intro__cloud wx-intro__cloud--a wx-intro__cloud--dim" />
          <span className="wx-intro__rain" />
        </>
      ) : null}
      {kind === "night" ? (
        <>
          <span className="wx-intro__moon" />
          <span className="wx-intro__star wx-intro__star--a" />
          <span className="wx-intro__star wx-intro__star--b" />
          <span className="wx-intro__star wx-intro__star--c" />
          <span className="wx-intro__star wx-intro__star--d" />
          <span className="wx-intro__star wx-intro__star--e" />
          <span className="wx-intro__star wx-intro__star--f" />
        </>
      ) : null}
      <p className="wx-intro__label">{weatherIntroLabel(kind)}</p>
    </div>
  );
}
