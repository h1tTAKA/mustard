"use client";
// 설정 > 터미널 > Ghostty 설정 가져오기(#1224) — 정해진 위치의 config를 main이 읽고, 없으면 파일 고르기.
// 글꼴·크기·커서·여백·선택 시 복사·Option=Alt 등 + 테마 이름(목록에서 찾기, light:/dark: 따로) + 색 줄(테마 위 덮어쓰기).
import { useRef } from "react";
import { IconUpload } from "@tabler/icons-react";
import { useT, useToast, setSetting, getSetting, TKEYS, parseGhosttyConfig, parseGhosttyTheme, normalizeHex, readStoredTheme, readOverrides, BUILTIN_TERMINAL_THEMES, THEME_FILE_MAX, type TermTheme } from "@mustard/core";
import { SettingRow } from "./settingsControls";
import { loadCatalog } from "./TerminalThemeSection";

const readConfig = () => (typeof window === "undefined" ? undefined : (window.nunopiDesktop as unknown as { terminal?: { readGhosttyConfig?: () => Promise<{ path: string; text: string } | null> } } | undefined)?.terminal?.readGhosttyConfig);

export default function GhosttyImportRow() {
  const t = useT();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const apply = async (text: string) => {
    const r = parseGhosttyConfig(text);
    const skipped = new Set(r.skipped);
    for (const [field, v] of Object.entries(r.settings)) setSetting(TKEYS[field as keyof typeof TKEYS], v);
    if (r.theme) {
      const custom = getSetting<unknown[]>(TKEYS.customThemes, []);
      const all: TermTheme[] = [...(Array.isArray(custom) ? custom.flatMap((v) => { const th = readStoredTheme(v); return th ? [th] : []; }) : []), ...BUILTIN_TERMINAL_THEMES, ...(await loadCatalog())];
      const find = (name: string) => all.find((th) => th.name.toLowerCase() === name.toLowerCase());
      const dark = find(r.theme.dark), light = r.theme.light ? find(r.theme.light) : undefined;
      if (dark && (!r.theme.light || light)) {
        setSetting(TKEYS.themeDark, { name: dark.name, colors: dark.colors });
        if (light) setSetting(TKEYS.themeLight, { name: light.name, colors: light.colors });
        setSetting(TKEYS.themeSeparateLight, !!light && light.name !== dark.name);
      } else skipped.add("theme"); // 목록에 없는 이름
    }
    // 색 줄 = 테마 위에 덮어쓰기(Ghostty도 테마 다음에 적용). 다크·라이트 둘 다.
    const part = parseGhosttyTheme(r.colorLines);
    const over = Object.fromEntries(Object.entries(part).flatMap(([k, v]) => { const c = normalizeHex(v); return c ? [[k, c]] : []; }));
    // 이미 바꿔 둔 색은 남기고 같은 칸만 Ghostty 값으로(리뷰)
    if (Object.keys(over).length) for (const k of [TKEYS.colorOverridesDark, TKEYS.colorOverridesLight]) setSetting(k, { ...readOverrides(getSetting<unknown>(k, undefined)), ...over });
    const n = r.used.length - (skipped.has("theme") && r.used.includes("theme") ? 1 : 0);
    if (!n) { toast(t("settings.ghostty.none"), "error"); return; }
    toast(skipped.size ? t("settings.ghostty.doneSkipped", { n, m: skipped.size, keys: [...skipped].slice(0, 5).join(", ") }) : t("settings.ghostty.done", { n }));
  };

  const start = async () => {
    const got = await readConfig()?.().catch(() => null);
    if (got) { await apply(got.text); return; }
    fileRef.current?.click(); // 기본 위치에 없음(또는 데스크톱 앱 아님) → 직접 고르기
  };
  const onFile = async (f: File | undefined) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!f) return;
    if (f.size > THEME_FILE_MAX) { toast(t("settings.termTheme.tooBig", { name: f.name }), "error"); return; }
    await apply(await f.text());
  };

  return (
    <SettingRow title={t("settings.ghostty.title")} desc={t("settings.ghostty.desc")}>
      <input ref={fileRef} type="file" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
      <button type="button" onClick={() => void start()}
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"><IconUpload size={13} stroke={2} aria-hidden />{t("settings.ghostty.button")}</button>
    </SettingRow>
  );
}
