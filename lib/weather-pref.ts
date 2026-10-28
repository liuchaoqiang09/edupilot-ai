/** 登录迎宾天气层：个人开关（本机，默认开启） */

export const WEATHER_INTRO_ENABLED_KEY = "edupilot-weather-intro-enabled";

export function isWeatherIntroEnabled() {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(WEATHER_INTRO_ENABLED_KEY);
    if (raw === null) return true;
    return raw === "1";
  } catch {
    return true;
  }
}

export function setWeatherIntroEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(WEATHER_INTRO_ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}
