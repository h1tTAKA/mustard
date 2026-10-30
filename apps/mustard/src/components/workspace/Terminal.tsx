"use client";
// 워크스페이스 터미널(#647) — xterm.js(WebGL) 프론트 + detached pty 데몬 세션(#682).
// pty는 앱과 분리된 데몬이 소유해 앱 종료에도 생존, 재마운트/재실행 시 scrollback 재생 + live reattach.
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import { findLinks, resolvePath, type TerminalLink } from "@/lib/terminalLinks";
import { useT, currentTerminalTheme, isCurrentTerminalDark, TERMINAL_THEME_EVENT, getSetting, subscribeSettings, TKEYS, TERMINAL_DEFAULTS, registerShortcut, trimSelectionGutter, readMacOptionAsAlt, effectiveMacOptionAsAlt, altCharForCode, jisYenInput, DEFAULT_WORD_SEPARATOR, parseShellArgs, readGpuMode, gpuAllowed, resolveMinContrast, isLightColor, readFontWeight, readPadding, withAlpha } from "@mustard/core";
import { inputSourceId, refreshInputSource, subscribeInputSource } from "@/lib/inputSource";

// 터미널 설정(#926) — 스토어서 읽어 xterm 옵션 구성. copyOnSelect/rightClickPaste는 핸들러서 별도.
// #1213 지금 Option을 Alt로 — 자동이면 입력 소스(US·ABC = 양쪽, 그 외·모름 = 끄기)로 정함.
const macOptionMode = () => effectiveMacOptionAsAlt(readMacOptionAsAlt(getSetting<unknown>(TKEYS.macOptionAsAlt, undefined), getSetting<unknown>(TKEYS.macOptionIsMeta, undefined)), inputSourceId()); // 새 키 없으면 옛 스위치(켜짐 = 양쪽)

// #1214 최소 색상 대비 — 자동이면 지금 터미널 배경 밝기로(밝으면 4.5, 어두우면 3).
// #1214 터미널 여백(세로 가로)
const padding = () => `${readPadding(getSetting<unknown>(TKEYS.paddingY, undefined), TERMINAL_DEFAULTS.paddingY)}px ${readPadding(getSetting<unknown>(TKEYS.paddingX, undefined), TERMINAL_DEFAULTS.paddingX)}px`;
const minContrast = () => resolveMinContrast(getSetting<unknown>(TKEYS.minContrast, TERMINAL_DEFAULTS.minContrast), isLightColor(buildTermTheme().background));

// #1214 GPU 이름(리눅스 자동 판단용) — 한 번만 읽음. 못 읽으면 null.
let gpuNameCache: string | null | undefined;
function gpuName(): string | null {
  if (gpuNameCache !== undefined) return gpuNameCache;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    gpuNameCache = gl && ext ? `${gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)} ${gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}` : null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext(); // 확인용 문맥은 바로 돌려줌
  } catch { gpuNameCache = null; }
  return gpuNameCache;
}

function termOptionsFromSettings() {
  return {
    fontSize: getSetting<number>(TKEYS.fontSize, TERMINAL_DEFAULTS.fontSize),
    fontFamily: getSetting<string>(TKEYS.fontFamily, TERMINAL_DEFAULTS.fontFamily),
    lineHeight: getSetting<number>(TKEYS.lineHeight, TERMINAL_DEFAULTS.lineHeight),
    cursorStyle: getSetting<"bar" | "block" | "underline">(TKEYS.cursorStyle, TERMINAL_DEFAULTS.cursorStyle),
    cursorBlink: getSetting<boolean>(TKEYS.cursorBlink, TERMINAL_DEFAULTS.cursorBlink),
    scrollback: getSetting<number>(TKEYS.scrollback, TERMINAL_DEFAULTS.scrollback),
    // 심화(#941)
    fontWeight: readFontWeight(getSetting<unknown>(TKEYS.fontWeight, undefined), TERMINAL_DEFAULTS.fontWeight), // #1214 100~900
    fontWeightBold: readFontWeight(getSetting<unknown>(TKEYS.fontWeightBold, undefined), TERMINAL_DEFAULTS.fontWeightBold),
    scrollSensitivity: getSetting<number>(TKEYS.scrollSensitivity, TERMINAL_DEFAULTS.scrollSensitivity),
    fastScrollSensitivity: getSetting<number>(TKEYS.fastScrollSensitivity, TERMINAL_DEFAULTS.fastScrollSensitivity), // #1212 ⌥ 누른 채
    minimumContrastRatio: minContrast(), // #1214 글자색이 배경과 비슷하면 진하게
    wordSeparator: getSetting<string>(TKEYS.wordSeparator, TERMINAL_DEFAULTS.wordSeparator) || DEFAULT_WORD_SEPARATOR, // #1213 더블클릭 단어 구분
    macOptionIsMeta: macOptionMode() === "both", // #1213 양쪽만 xterm이 처리, 한쪽만은 키 핸들러가 ESC+글자
  };
}

// 터미널 링크(#1193) — ⌘+클릭(맥)/Ctrl+클릭으로 엶. 그냥 클릭은 선택·복사용 그대로. 여는 일은 그 레포 화면(WorkspaceView)이 함.
export const TERMINAL_LINK_EVENT = "mustard:terminal-link";
export type TerminalLinkDetail = { cwd: string } & ({ kind: "url"; url: string } | { kind: "file"; path: string; line?: number });
const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const isLinux = typeof navigator !== "undefined" && /Linux/i.test(navigator.platform) && !/Android/i.test(navigator.userAgent);
const withMod = (ev: MouseEvent) => (isMac ? ev.metaKey : ev.ctrlKey);
// #1209 여는 클릭 = ⌘/Ctrl+왼쪽 클릭 또는 가운데 클릭(브라우저 관례). ⌘⇧클릭 = 웹 링크를 설정과 반대쪽(앱 안 ↔ 외부)으로 이번만.
const opens = (ev: MouseEvent) => (ev.button === 1 && !isLinux) || (ev.button === 0 && withMod(ev)); // 리눅스 가운데 클릭 = 붙여넣기 관례라 거기선 안 엶(리뷰)
const flips = (ev: MouseEvent) => ev.button === 0 && ev.shiftKey;
function openTerminalLink(cwd: string, l: TerminalLink | { kind: "url"; url: string }, flip = false) {
  const external = getSetting<string>(TKEYS.linkTarget, TERMINAL_DEFAULTS.linkTarget) === "external";
  if (l.kind === "url" && external !== flip) { void window.nunopiDesktop?.openExternal?.(l.url); return; }
  const detail: TerminalLinkDetail = l.kind === "url" ? { cwd, kind: "url", url: l.url } : { cwd, kind: "file", path: l.path, line: l.line };
  window.dispatchEvent(new CustomEvent(TERMINAL_LINK_EVENT, { detail }));
}
// 버퍼 한 줄 → 글자와 "글자 위치 → 화면 칸" 표(한글·이모지는 두 칸이라 문자열 위치와 칸이 다름)
// #1212 복사할 글 — 설정이 켜져 있으면(기본) 모든 줄에 공통인 왼쪽 여백을 자름(에이전트 TUI의 들여 그린 본문)
// 첫 줄에서 선택 시작 앞에 있던 화면 글자 — 들여쓰기 안에서 시작했는지/줄 중간부터인지 가리는 데 씀(리뷰).
// start.x는 0-based 칸(xterm 6 소스 selectionStart 그대로 — 타입 주석의 1-based와 다름, 리뷰). 그 칸부터 첫 줄 글이 이어질 때만 믿고, 아니면 undefined = 글만으로 판단.
function selectionPrefix(term: import("@xterm/xterm").Terminal, sel: string): string | undefined {
  const pos = term.getSelectionPosition();
  const line = pos ? term.buffer.active.getLine(pos.start.y) : undefined;
  if (!pos || !line || pos.start.x < 0) return undefined;
  // 칸 번호로 잘라야 함 — 한글 같은 두 칸 글자가 있으면 문자열 위치와 칸이 어긋남(리뷰). translateToString(_, 시작칸, 끝칸)은 칸 기준.
  const first = sel.split("\n")[0].replace(/\r$/, "").trimEnd();
  return line.translateToString(false, pos.start.x).startsWith(first) ? line.translateToString(false, 0, pos.start.x) : undefined;
}
const copyText = (term: import("@xterm/xterm").Terminal) => {
  const sel = term.getSelection();
  return getSetting<boolean>(TKEYS.copyTrimGutter, TERMINAL_DEFAULTS.copyTrimGutter) ? trimSelectionGutter(sel, selectionPrefix(term, sel)) : sel;
};
function lineText(line: import("@xterm/xterm").IBufferLine) {
  let text = ""; const col: number[] = [], wid: number[] = [];
  for (let x = 0; x < line.length; x++) {
    const c = line.getCell(x);
    if (!c || c.getWidth() === 0) continue; // 넓은 글자의 둘째 칸
    const ch = c.getChars() || " ";
    for (let i = 0; i < ch.length; i++) { col.push(x); wid.push(c.getWidth()); }
    text += ch;
  }
  col.push(line.length);
  return { text, col, wid };
}

function buildTermTheme() {
  const base = currentTerminalTheme().colors; // #1215 다크용·라이트용 테마(앱 다크 여부로 고름)
  return { ...base, cursor: withAlpha(base.cursor, getSetting<unknown>(TKEYS.cursorOpacity, TERMINAL_DEFAULTS.cursorOpacity)) }; // #1214 커서 투명도
}
// 재접속 스크롤백 재생 시 xterm이 버퍼 속 터미널 질의(DA/DSR/OSC 색 등)에 "다시" 응답해
// 입력창에 에코되는 문제(#807) 방지 — 질의는 화면 출력이 없어 재생 전 제거(라이브 스트림엔 미적용).
// xterm.write는 비동기 파싱이라, 재생 시점에 term.onData(→pty)가 연결된 뒤 질의가 파싱돼 응답이 pty로 새 나감.
function stripTermQueries(s: string): string {
  return s
    .replace(/\x1b\[[?>=]?[0-9;]*[cn]/g, "")             // Primary/Secondary/Tertiary DA(c) · DSR 커서/상태(n)
    .replace(/\x1b\](?:4;\d+|1[0-9]);\?(?:\x07|\x1b\\)/g, "")  // OSC 색/팔레트 질의만(]4;n;? · ]1x;?) — ]0;제목? 등은 보존
    .replace(/\x1b\[\?[0-9;]*\$p/g, "")                  // DECRQM 모드 질의
    .replace(/\x1b\[>[0-9;]*q/g, "");                    // XTVERSION
}

export default function Terminal({ id, cwd }: { id: string; cwd: string }) {
  const t = useT();
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]); // 최신 t 유지 — locale 바뀌어도 터미널 remount 없이 exit 안내 언어 반영
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const nd = window.nunopiDesktop;
    const host = hostRef.current;
    if (!nd?.terminal || !host) return;
    let disposed = false;
    let term: import("@xterm/xterm").Terminal | null = null;
    let offData: (() => void) | null = null;
    let offExit: (() => void) | null = null;
    let ro: ResizeObserver | null = null;
    let mo: MutationObserver | null = null;
    let offTheme: (() => void) | null = null;
    let offSettings: (() => void) | null = null;
    let offInputSource: (() => void) | null = null;
    let selDisp: { dispose(): void } | null = null;
    let linkDisp: { dispose(): void } | null = null;
    let oscDisp: { dispose(): void } | null = null;
    let osc52Disp: { dispose(): void } | null = null;
    // 셸의 지금 폴더 — 셸이 OSC 7(file://호스트/경로)을 보내면 따라감(cd 뒤 상대 경로 링크용, 리뷰). 안 보내면 터미널을 연 폴더.
    let shellCwd = cwd;
    // #1027 ⌘K(터미널 포커스) = 화면 지우기 — 포커스가 이 터미널 안일 때만 처리(다른 터미널·탭이면 false로 넘김).
    const offClear = registerShortcut(["term.clear"], () => { if (!term || !host.contains(document.activeElement)) return false; term.clear(); });
    let onCtx: ((e: MouseEvent) => void) | null = null;
    let onMid: ((e: MouseEvent) => void) | null = null;
    let onCopy: ((e: ClipboardEvent) => void) | null = null;
    let onEnter: (() => void) | null = null;
    const showMouse = () => host?.classList.remove("mustard-hide-mouse");
    let fallback: ReturnType<typeof setTimeout> | null = null;
    let onPaste: ((ev: ClipboardEvent) => void | Promise<void>) | undefined;

    (async () => {
      const [{ Terminal: XTerm }, { FitAddon }, webgl, imageMod] = await Promise.all([
        import("@xterm/xterm"), import("@xterm/addon-fit"), import("@xterm/addon-webgl"),
        getSetting<boolean>(TKEYS.images, TERMINAL_DEFAULTS.images) ? import("@xterm/addon-image") : Promise.resolve(null), // #1196 꺼져 있으면 안 불러옴
      ]);
      if (disposed) return;
      // OSC 8 하이퍼링크(요즘 CLI가 찍는 숨은 링크)도 같은 규칙 — http(s)만
      term = new XTerm({ ...termOptionsFromSettings(), theme: buildTermTheme(), linkHandler: { activate: (ev, uri) => { if (opens(ev) && /^https?:\/\//i.test(uri)) openTerminalLink(shellCwd, { kind: "url", url: uri }, flips(ev)); } } });
      if (host) host.style.background = buildTermTheme().background;
      const fit = new FitAddon();
      term.loadAddon(fit);
      // #1214 여백 — 바깥(host)에 padding, xterm은 안쪽 칸에 열어 fit이 여백 뺀 크기로 계산하게
      const inner = document.createElement("div");
      inner.style.cssText = "width:100%;height:100%";
      host.replaceChildren(inner); // 같은 화면을 다시 그릴 때 전 칸이 남아 쌓이지 않게(리뷰)
      term.open(inner);
      // #1196 인라인 이미지(sixel·iTerm 그림) — 새 탭부터
      if (imageMod) { try { term.loadAddon(new imageMod.ImageAddon()); } catch { /* 지원 안 함 */ } }
      // #1196 OSC 52 = 프로그램(tmux·neovim·ssh 너머)이 클립보드에 쓰기. 쓰기만(읽기 요청 "?"는 무시 — 클립보드가 새지 않게), 1MB까지(base64 1,333,336자 = 1MB = main 상한과 같음).
      osc52Disp = term.parser.registerOscHandler(52, (data) => {
        if (!getSetting<boolean>(TKEYS.osc52, TERMINAL_DEFAULTS.osc52)) return true;
        const b64 = data.slice(data.indexOf(";") + 1);
        if (!b64 || b64 === "?" || b64.length > 1_333_336) return true;
        try {
          const bin = atob(b64);
          const text = new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
          void window.nunopiDesktop?.writeClipboardText?.(text);
        } catch { /* base64 아님 */ }
        return true;
      });
      oscDisp = term.parser.registerOscHandler(7, (data) => {
        // 터미널을 연 폴더 안쪽일 때만 따라감 — 원격 셸이나 출력에 섞인 값이 다른 레포로 보내지 않게(리뷰)
        // . .. 을 먼저 정리하고 검사(리뷰)
        try { const u = new URL(data); const p = u.protocol === "file:" ? resolvePath("/", decodeURIComponent(u.pathname)) ?? "" : ""; const base = cwd.replace(/\/+$/, ""); if (p === base || p.startsWith(`${base}/`)) shellCwd = p; } catch { /* 형식 아님 */ }
        return false; // 다른 처리기도 받게
      });
      // 글자 속 링크(주소·파일 경로) — 마우스를 올리면 밑줄, ⌘/Ctrl+클릭으로 엶. 한계: 줄바꿈으로 두 줄에 걸친 링크는 못 찾음.
      linkDisp = term.registerLinkProvider({
        provideLinks(y, cb) {
          const ln = term?.buffer.active.getLine(y - 1);
          if (!ln) return cb(undefined);
          const { text, col, wid } = lineText(ln);
          const links = findLinks(text).map((l) => ({
            text: l.text,
            range: { start: { x: col[l.start] + 1, y }, end: { x: col[l.start + l.text.length - 1] + wid[l.start + l.text.length - 1], y } }, // 끝 글자가 두 칸이면 둘째 칸까지(리뷰)
            decorations: { underline: true, pointerCursor: true },
            activate: (ev: MouseEvent) => { if (opens(ev)) openTerminalLink(shellCwd, l, flips(ev)); },
          }));
          cb(links.length ? links : undefined);
        },
      });
      // GPU(WebGL) 렌더 — #1214 자동(리눅스 소프트웨어 렌더면 일반 렌더)/켜짐/끄기, 새 탭부터. 옛 gpu 스위치는 옮겨 읽음.
      const gpuMode = readGpuMode(getSetting<unknown>(TKEYS.gpuMode, undefined), getSetting<unknown>(TKEYS.gpu, undefined));
      if (gpuAllowed(gpuMode, isLinux, gpuMode === "auto" && isLinux ? gpuName() : null)) {
        try {
          const gl = new webgl.WebglAddon();
          // #1165 GPU 프로세스가 다시 뜨면 WebGL 문맥이 사라짐 → 그대로 두면 글자 빠짐·흰 화면. 떼면 xterm이 기본(DOM) 렌더로 바꾸고 전체를 다시 그림.
          // 한계: 이 탭은 WebGL로 안 돌아감(GPU가 또 죽을 수 있음) — 새 탭부터 다시 WebGL.
          gl.onContextLoss(() => gl.dispose());
          term.loadAddon(gl);
        } catch { /* WebGL 미지원 → 기본 렌더 폴백 */ }
      }
      // 테마 색 넣기 — 실제로 바뀔 때만(#1214: 테마를 다시 넣으면 프로그램이 OSC로 바꾼 색이 풀림). 라이트↔다크면 자동 대비도.
      let themeKey = JSON.stringify(buildTermTheme());
      const syncTheme = () => {
        const th = buildTermTheme();
        const k = JSON.stringify(th);
        if (!term || k === themeKey) return;
        themeKey = k;
        term.options.theme = th;
        term.options.minimumContrastRatio = minContrast();
        if (host) host.style.background = th.background;
      };
      // 설정 라이브 갱신(#926) — fontSize/lineHeight/cursor 등 즉시 반영 + fit. (scrollback/gpu는 새 탭부터.)
      const applyTermSettings = () => {
        if (!term) return;
        const o = termOptionsFromSettings();
        term.options.fontSize = o.fontSize;
        term.options.fontFamily = o.fontFamily;
        term.options.lineHeight = o.lineHeight;
        term.options.cursorStyle = o.cursorStyle;
        term.options.cursorBlink = o.cursorBlink;
        // 심화(#941) 라이브 반영
        term.options.fontWeight = o.fontWeight;
        term.options.fontWeightBold = o.fontWeightBold;
        if (host) host.style.padding = padding();
        if (host && !getSetting<boolean>(TKEYS.hideMouseWhileTyping, TERMINAL_DEFAULTS.hideMouseWhileTyping)) host.classList.remove("mustard-hide-mouse"); // 끄면 숨긴 마우스 바로(리뷰)
        syncTheme(); // #1214 커서 투명도·#1215 테마 고르기
        term.options.scrollSensitivity = o.scrollSensitivity;
        term.options.fastScrollSensitivity = o.fastScrollSensitivity;
        term.options.macOptionIsMeta = o.macOptionIsMeta;
        term.options.wordSeparator = o.wordSeparator;
        term.options.minimumContrastRatio = o.minimumContrastRatio;
        try { fit.fit(); } catch { /* ignore */ }
      };
      offSettings = subscribeSettings(applyTermSettings);
      offInputSource = subscribeInputSource(applyTermSettings); // #1213 입력 소스가 바뀌면 자동 판단 다시
      // 선택 시 복사(copyOnSelect) / 우클릭 붙여넣기(rightClickPaste) — 설정 시.
      const onSelChange = () => { if (!term) return; if (!getSetting<boolean>(TKEYS.copyOnSelect, TERMINAL_DEFAULTS.copyOnSelect)) return; const sel = copyText(term); if (sel) navigator.clipboard?.writeText(sel).catch(() => {}); };
      onCtx = (e: MouseEvent) => { if (!getSetting<boolean>(TKEYS.rightClickPaste, TERMINAL_DEFAULTS.rightClickPaste)) return; e.preventDefault(); navigator.clipboard?.readText().then((txt) => { if (txt) nd.terminal.input({ id, data: txt }); }).catch(() => {}); };
      selDisp = term.onSelectionChange(onSelChange);
      host.addEventListener("contextmenu", onCtx);
      // #1224 가운데 클릭 붙여넣기 — 켜면 터미널에서 선택한 글을 붙여넣음(term.paste = 괄호 붙여넣기 지원). 링크를 여는 가운데 클릭(리눅스 밖)은 링크가 먼저.
      // mousedown에서 막아야 리눅스 기본 붙여넣기(시스템 선택 영역)와 두 번 들어가지 않음.
      onMid = (e: MouseEvent) => {
        if (e.button !== 1 || !term || !getSetting<boolean>(TKEYS.middleClickPaste, TERMINAL_DEFAULTS.middleClickPaste)) return;
        if (!isLinux && host.querySelector(".xterm-cursor-pointer")) return; // 링크 위
        if (term.modes.mouseTrackingMode !== "none") return; // 마우스를 받는 프로그램(TUI)엔 클릭 그대로
        e.preventDefault();
        const sel = copyText(term);
        if (sel) term.paste(sel);
      };
      host.addEventListener("mousedown", onMid, true);
      // 마우스 포커스(#941) — 설정 켜지면 호버 시 터미널 포커스.
      onEnter = () => { if (getSetting<boolean>(TKEYS.focusFollowsMouse, TERMINAL_DEFAULTS.focusFollowsMouse)) term?.focus(); };
      host.addEventListener("mouseenter", onEnter);
      host.addEventListener("mousemove", showMouse); // #1214 타이핑 중 숨긴 마우스 다시
      // #973 터미널 벨 데스크톱 알림 제거 — 알림은 에이전트 ask/완료만(WorkspaceTabs). 터미널 벨 알림은 스팸이라 폐지.
      // 테마 라이브 전환(#914) — 터미널 설정(dark/light/auto) 변경 또는 auto일 때 앱 .dark 변경 시 색 갱신.
      const applyTermTheme = syncTheme;
      mo = new MutationObserver(applyTermTheme);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
      window.addEventListener(TERMINAL_THEME_EVENT, applyTermTheme);
      offTheme = () => window.removeEventListener(TERMINAL_THEME_EVENT, applyTermTheme);

      // OSC 10/11 색 질의 응답(#914) — CLI(claude 등)가 `ESC]11;?ESC\`로 배경색을 물으면
      // 현재 터미널 테마의 bg/fg를 rgb:RRRR/GGGG/BBBB로 답한다 → CLI가 배경 명암을 감지해 스스로
      // 라이트/다크에 맞는 색(diff 배경·dim 등)을 고른다. env(COLORFGBG)가 아니라 터미널 능력 응답.
      const oscColorReply = (slot: 10 | 11) => {
        const th = buildTermTheme();
        const hex = slot === 11 ? th.background : th.foreground;
        const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
        if (!m) return true;
        const [, r, g, b] = m;
        nd.terminal.input({ id, data: `\x1b]${slot};rgb:${r}${r}/${g}${g}/${b}${b}\x1b\\` });
        return true;
      };
      term.parser.registerOscHandler(10, (d) => (d === "?" ? oscColorReply(10) : false));
      term.parser.registerOscHandler(11, (d) => (d === "?" ? oscColorReply(11) : false));

      // #1212 ⌘C·Ctrl+Shift+C 복사도 여백 자르기 — xterm이 textarea에서 copy를 처리하기 전에(캡처) 같은 글로 바꿔 씀
      onCopy = (e: ClipboardEvent) => {
        if (!term?.hasSelection() || !e.clipboardData) return;
        e.clipboardData.setData("text/plain", copyText(term));
        e.preventDefault(); e.stopImmediatePropagation();
      };
      host.addEventListener("copy", onCopy, true);

      // #1212 TUI 휠 배율 — 마우스를 추적하는 전체 화면 프로그램(Claude Code·vim·less)에는 휠 한 번이 보고 한 번이라
      // scrollSensitivity가 안 먹음 → 배율-1번 같은 휠을 더 보냄. 복제는 표시해 다시 늘리지 않음.
      const replayed = new WeakSet<Event>();
      term.attachCustomWheelEventHandler((ev) => {
        if (replayed.has(ev) || !term || term.modes.mouseTrackingMode === "none") return true;
        const k = Math.min(10, Math.max(1, Math.round(getSetting<number>(TKEYS.tuiScrollSensitivity, TERMINAL_DEFAULTS.tuiScrollSensitivity))));
        const tgt = ev.target;
        for (let i = 1; i < k && tgt; i++) { const c = new WheelEvent(ev.type, ev); replayed.add(c); queueMicrotask(() => tgt.dispatchEvent(c)); }
        return true;
      });

      // Shift+Enter(#799) — CSI-u(kitty/fixterms)로 인코딩된 "Shift+Enter" 키 이벤트를 전송.
      // \x1b[13;2u = Enter(13) + Shift 수정자(2). 에이전트 CLI(Claude Code 등)가 이를 진짜 개행 키로
      // 파싱해 멀티라인·백스페이스 정상(생 \n/ESC+CR은 리터럴로 오처리돼 1줄만/백스페이스 깨짐). false로 CR 제출 차단.
      // #1213 한쪽 ⌥만 Alt — 어느 ⌥가 눌렸는지(location 1 왼쪽, 2 오른쪽) 기억했다가 그쪽이면 ESC+그 키 글자를 직접 보냄.
      // preventDefault로 브라우저가 å 같은 조합 글자를 넣지 않게(⇧ 같이 누르면 ESC+대문자·⇧기호). IME 조합 중은 건드리지 않음.
      let optBits = 0;
      term.textarea?.addEventListener("blur", () => { optBits = 0; });
      term.attachCustomKeyEventHandler((e) => {
        // #1213 JIS ¥ 키 → 백슬래시(keydown에 넣고 keypress·keyup은 삼킴)
        const yen = isMac ? jisYenInput(e, getSetting<boolean>(TKEYS.jisYenToBackslash, TERMINAL_DEFAULTS.jisYenToBackslash)) : null;
        if (yen) { e.preventDefault(); if (yen === "input") nd.terminal.input({ id, data: "\\" }); return false; }
        if (e.key === "Alt") {
          const bit = e.location === 1 ? 1 : e.location === 2 ? 2 : 0;
          if (e.type === "keydown") { optBits = bit ? optBits | bit : 0; refreshInputSource(); }
          else if (e.type === "keyup") optBits = bit ? optBits & ~bit : 0;
          return true;
        }
        if (isMac && e.type === "keydown" && e.altKey && !e.metaKey && !e.ctrlKey && !e.isComposing && e.keyCode !== 229) {
          // xterm에 넣어 둔 값이 양쪽이면 xterm이 처리(입력 소스가 막 바뀐 순간에도 두 경로가 겹치지 않게 같은 값을 봄 — 리뷰)
          const mode = term?.options.macOptionIsMeta ? "both" : macOptionMode();
          const ch = (mode === "left" && optBits & 1) || (mode === "right" && optBits & 2) ? altCharForCode(e.code, e.shiftKey) : null;
          if (ch) { e.preventDefault(); nd.terminal.input({ id, data: "\x1b" + ch }); return false; }
        }
        if (e.type === "keydown" && e.key === "Enter" && e.shiftKey) {
          e.preventDefault(); // 브라우저가 Enter를 textarea에 넣어 xterm이 CR을 또 보내는 것 차단(개행 후 CR 제출로 되돌아가던 원인)
          nd.terminal.input({ id, data: "\x1b[13;2u" });
          return false;
        }
        return true;
      });

      // Cmd+V 이미지 붙여넣기(#799) — 클립보드에 이미지가 있으면 임시 PNG로 저장 후 그 경로를 터미널에
      // 주입(에이전트 CLI가 파일 경로로 첨부 인식). 텍스트 붙여넣기는 가로채지 않고 xterm 기본 처리.
      // capture 단계 — xterm textarea 핸들러보다 먼저 이미지만 preventDefault.
      onPaste = async (ev: ClipboardEvent) => {
        const items = ev.clipboardData?.items;
        if (!items || !Array.from(items).some((it) => it.type.startsWith("image/"))) return; // 텍스트는 통과
        ev.preventDefault();
        ev.stopPropagation();
        try {
          const r = await nd.saveClipboardImage?.();
          // bracketed paste(ESC[200~ … ESC[201~)로 경로를 "붙여넣기"로 전달 → Claude Code 등이 이미지
          // 파일 경로로 인식해 [Image #N]으로 표시(생 키입력이면 경로 텍스트 그대로 남음).
          if (r?.ok && r.path && term) nd.terminal.input({ id, data: `\x1b[200~${r.path}\x1b[201~` });
        } catch { /* ignore */ }
      };
      host.addEventListener("paste", onPaste, true);

      // host 폭이 확정된 뒤에만 fit/ensure(#832). open 직후·tab mount·독 분할 애니메이션 중엔 host 폭이 0~극소로
      // 측정돼 cols가 2~10으로 잡히고, 그 폭으로 재생된 scrollback 줄바꿈이 굳어 세로로 깨진다(#682). 단일 rAF는
      // 레이아웃 확정을 보장 못 함 → ResizeObserver가 "실제 폭"을 보고할 때 최초 ensure를 한 번 실행, 이후엔 live resize.
      const MIN_W = 40; // 이보다 좁으면(≈5 cols 미만) 아직 레이아웃 미확정으로 보고 대기
      let ensured = false;
      const firstEnsure = async () => {
        if (disposed || !term) return;
        try {
          const r = await nd.terminal.ensure({ id, cwd, cols: term.cols, rows: term.rows, dark: isCurrentTerminalDark(), shell: getSetting<string>(TKEYS.shell, TERMINAL_DEFAULTS.shell), shellArgs: parseShellArgs(getSetting<string>(TKEYS.shellArgs, TERMINAL_DEFAULTS.shellArgs)) }); // #1196 새 세션만 셸 적용(있는 세션은 그대로), #1213 셸 인자
          if (disposed || !term) return;
          if (!r.ok) { term.write(`\r\n[${tRef.current("terminal.startFailed", { reason: r.reason ? `: ${r.reason}` : "" })}]\r\n`); return; }
          if (r.buffer) term.write(stripTermQueries(r.buffer)); // 정확한 cols 확보 후 재생(줄바꿈 안 굳음). 질의 시퀀스 제거(에코 방지 #807)
          offData = nd.terminal.onData(({ id: i, data }) => { if (i === id && term) term.write(data); });
          // 셸 종료 시 빈 화면 방치 대신 안내(+로 새 터미널).
          offExit = nd.terminal.onExit(({ id: i }) => { if (i === id && term) term.write(`\r\n\x1b[2m${tRef.current("workspace.terminalExited")}\x1b[0m\r\n`); });
          term.onData((d) => {
        nd.terminal.input({ id, data: d });
        // #1214 타이핑 중 마우스 숨기기 — 치면 숨기고 마우스를 움직이면 다시
        if (host && getSetting<boolean>(TKEYS.hideMouseWhileTyping, TERMINAL_DEFAULTS.hideMouseWhileTyping)) host.classList.add("mustard-hide-mouse");
      });
        } catch {
          // 핸들러 미등록(옛 메인) 등 — 크래시 대신 안내.
          if (term && !disposed) term.write(`\r\n[${tRef.current("terminal.connectFailed")}]\r\n`);
        }
      };
      // 폭이 잡혔을 때만 fit → 최초 1회 ensure, 이후 resize. 폭 미확정이면 스킵(다음 콜백/폴백서 처리).
      const sync = () => {
        if (disposed || !term || inner.clientWidth < MIN_W) return; // #1214 여백 뺀 안쪽 폭으로(리뷰)
        try { fit.fit(); } catch { /* ignore */ }
        if (!ensured) { ensured = true; void firstEnsure(); }
        else { try { nd.terminal.resize({ id, cols: term.cols, rows: term.rows }); } catch { /* ignore */ } }
      };
      ro = new ResizeObserver(sync);
      ro.observe(inner);
      requestAnimationFrame(sync); // 이미 폭이 잡혀 있으면 즉시 진행
      // 폭이 끝내 안 잡혀도(희귀) 터미널이 빈 채 방치되지 않게 폴백 — 최후엔 강제 ensure(데몬이 cols 하한 클램프).
      fallback = setTimeout(() => { if (!ensured && !disposed && term) { ensured = true; void firstEnsure(); } }, 1500);
    })();

    return () => { offClear(); disposed = true; if (fallback) clearTimeout(fallback); if (onPaste) host.removeEventListener("paste", onPaste, true); if (onCopy) host.removeEventListener("copy", onCopy, true); offData?.(); offExit?.(); ro?.disconnect(); mo?.disconnect(); offTheme?.(); offSettings?.(); offInputSource?.(); selDisp?.dispose(); linkDisp?.dispose(); oscDisp?.dispose(); osc52Disp?.dispose(); if (onCtx) host.removeEventListener("contextmenu", onCtx); if (onMid) host.removeEventListener("mousedown", onMid, true); if (onEnter) host.removeEventListener("mouseenter", onEnter); host.removeEventListener("mousemove", showMouse); term?.dispose(); term = null; };
  }, [id, cwd]);

  // 초기 배경도 현재 터미널 테마에 맞춰(라이트 앱 첫 프레임 다크 깜빡임 방지). 클라이언트 전용 pane이라 안전.
  const initialBg = typeof document !== "undefined" ? buildTermTheme().background : "#0a0a0a"; // #956 pref별 배경(검정/그레이/흰색)
  return <div ref={hostRef} className="h-full w-full overflow-hidden" style={{ background: initialBg, padding: padding() }} />;
}
