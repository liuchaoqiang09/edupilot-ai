/** 登录迎宾天气层：session 标记 + 当地天气/夜间判定 */

export const WEATHER_INTRO_KEY = "edupilot-weather-intro";

export type WeatherIntroKind = "clear" | "cloudy" | "rain" | "night";

export function markWeatherIntroPending() {
  try {
    window.sessionStorage.setItem(WEATHER_INTRO_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** 只读不删：避免 React Strict Mode 双挂载时第一次就把标记吃掉。 */
export function peekWeatherIntroPending() {
  try {
    return window.sessionStorage.getItem(WEATHER_INTRO_KEY) === "1";
  } catch {
    return false;
  }
}

/** 迎宾层开始播放后再清，防止同会话刷新重复播。 */
export function clearWeatherIntroPending() {
  try {
    window.sessionStorage.removeItem(WEATHER_INTRO_KEY);
  } catch {
    /* ignore */
  }
}

/** 本地时间 ≥ 19:00（含 19 点整）视为夜间。 */
export function isNightLocal(date = new Date()) {
  return date.getHours() >= 19;
}

function mapWeatherCode(code: number): Exclude<WeatherIntroKind, "night"> {
  if (code <= 1) return "clear";
  if (code <= 3 || (code >= 45 && code <= 48)) return "cloudy";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 99) || (code >= 71 && code <= 77)) return "rain";
  return "cloudy";
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), ms);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        window.clearTimeout(timer);
        resolve(null);
      });
  });
}

function readCoords(): Promise<{ lat: number; lon: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 700, maximumAge: 30 * 60 * 1000 },
    );
  });
}

async function fetchOpenMeteo(lat: number, lon: number): Promise<Exclude<WeatherIntroKind, "night"> | null> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code`;
  const controller = new AbortController();
  const kill = window.setTimeout(() => controller.abort(), 800);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const data = (await response.json()) as { current?: { weather_code?: number } };
    const code = data.current?.weather_code;
    if (typeof code !== "number") return null;
    return mapWeatherCode(code);
  } finally {
    window.clearTimeout(kill);
  }
}

/**
 * 夜间优先；白天再按当地天气。定位/接口失败则阴天。
 * 总等待尽量控制在约 1s 内，不阻塞工作台。
 */
export async function resolveWeatherIntroKind(): Promise<WeatherIntroKind> {
  if (isNightLocal()) return "night";

  const coords = await withTimeout(readCoords(), 750);
  if (!coords) return "cloudy";

  const kind = await withTimeout(fetchOpenMeteo(coords.lat, coords.lon), 850);
  return kind ?? "cloudy";
}

export function weatherIntroLabel(kind: WeatherIntroKind, locale: "zh" | "en" = "zh") {
  if (locale === "en") {
    if (kind === "clear") return "Clear skies";
    if (kind === "cloudy") return "Cloudy";
    if (kind === "rain") return "Rain";
    return "Evening";
  }
  if (kind === "clear") return "今日晴好";
  if (kind === "cloudy") return "今日多云";
  if (kind === "rain") return "今日有雨";
  return "夜色渐深";
}
