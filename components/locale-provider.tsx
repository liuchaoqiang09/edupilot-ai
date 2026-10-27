"use client";

import { createContext, useContext, useEffect } from "react";
import { pick, publicLabel, type Locale } from "@/lib/locale";

const LocaleContext = createContext<Locale>("zh-CN");

export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = locale === "en" ? "en" : "zh-CN";
  }, [locale]);
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

export function usePick() {
  const locale = useLocale();
  return (zh: string, en: string) => pick(locale, zh, en);
}

export function usePublicLabel() {
  const locale = useLocale();
  return (text: string) => publicLabel(locale, text);
}
