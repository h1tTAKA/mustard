"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { MESSAGES, type Locale } from "./messages";

const STORAGE_KEY = "nunopi:locale";
const CHANGE_EVENT = "nunopi:locale-change";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: TFn;
}

const I18nContext = createContext<I18nValue | null>(null);

function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

// #1125 언어 = localStorage를 바깥 저장소로 구독(useSyncExternalStore).
// 예전엔 useState("ko") 후 effect에서 읽어서, 자식 effect(부모보다 먼저 실행)·첫 렌더에서 만든 값이 영어 사용자도 ko로 만들어지고 저장됐음.
// 클라 마운트(머스타드는 SPLASH 뒤 마운트)는 처음부터 저장 언어, SSR 하이드레이션(누노피 단독)은 서버 스냅샷 ko로 불일치 없이 맞춘 뒤 바로 갱신.
// storage 이벤트 = 다른 창(분리 브라우저 창 등)에서 바꿔도 따라옴.
// 저장소가 막힌 환경(사생활 창 등)에서도 이 창 안에서는 바꿀 수 있게 메모리 값도 둠(리뷰).
// 이 창에서 쓰기 실패했으면 메모리 값 우선(읽기는 옛 값을 돌려줄 때도 바뀌게), 다른 창이 바꾸면(storage 이벤트) 다시 저장소 기준.
let memLocale: Locale = "ko";
let wroteHere = false;
function readLocale(): Locale {
  if (wroteHere) return memLocale;
  try { const s = localStorage.getItem(STORAGE_KEY); if (s === "ko" || s === "ja" || s === "en") return s; } catch { /* 저장소 불가 */ }
  return memLocale;
}
function subscribeLocale(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) { wroteHere = false; cb(); } };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, cb);
  return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(CHANGE_EVENT, cb); };
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore<Locale>(subscribeLocale, readLocale, () => "ko");

  // 문서 언어 + 서버·Electron 언어(캐치업·Crew·GitHub 오류 문구 등)를 앱 언어로 — 워크스페이스를 안 열어도(#1125).
  // 누노피 단독 앱엔 /api/locale이 없어 실패해도 무시.
  useEffect(() => {
    document.documentElement.lang = locale;
    void fetch("/api/locale", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale }) }).catch(() => {});
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    memLocale = l;
    try { localStorage.setItem(STORAGE_KEY, l); wroteHere = false; } catch { wroteHere = true; } // 쓰기 실패 때만 메모리 우선
    window.dispatchEvent(new Event(CHANGE_EVENT)); // 같은 창 구독자 갱신(storage 이벤트는 다른 창에만 옴)
  }, []);

  const t = useCallback<TFn>(
    (key, vars) => {
      const dict = MESSAGES[locale] ?? MESSAGES.ko;
      const s = dict[key] ?? MESSAGES.ko[key] ?? key;
      return interpolate(s, vars);
    },
    [locale],
  );

  const value = useMemo<I18nValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  // Provider 밖에서도 깨지지 않게 ko 폴백.
  if (!ctx) {
    return {
      locale: "ko",
      setLocale: () => {},
      t: (key, vars) => interpolate(MESSAGES.ko[key] ?? key, vars),
    };
  }
  return ctx;
}

export function useLocale(): { locale: Locale; setLocale: (l: Locale) => void } {
  const { locale, setLocale } = useI18n();
  return { locale, setLocale };
}

export function useT(): TFn {
  return useI18n().t;
}
