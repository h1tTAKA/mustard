"use client";
// 워크스페이스 터미널(#647) — xterm.js(WebGL) 프론트 + detached pty 데몬 세션(#682).
// pty는 앱과 분리된 데몬이 소유해 앱 종료에도 생존, 재마운트/재실행 시 scrollback 재생 + live reattach.
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import { findLinks, resolvePath, type TerminalLink } from "@/lib/terminalLinks";
import { useT, getTerminalThemePref, isTerminalDark, TERMINAL_THEME_EVENT, getSetting, subscribeSettings, TKEYS, TERMINAL_DEFAULTS, registerShortcut, type TerminalFontWeight } from "@mustard/core";

// 터미널 설정(#926) — 스토어서 읽어 xterm 옵션 구성. copyOnSelect/rightClickPaste는 핸들러서 별도.
function termOptionsFromSettings() {
  return {
    fontSize: getSetting<number>(TKEYS.fontSize, TERMINAL_DEFAULTS.fontSize),
    fontFamily: getSetting<string>(TKEYS.fontFamily, TERMINAL_DEFAULTS.fontFamily),
    lineHeight: getSetting<number>(TKEYS.lineHeight, TERMINAL_DEFAULTS.lineHeight),
    cursorStyle: getSetting<"bar" | "block" | "underline">(TKEYS.cursorStyle, TERMINAL_DEFAULTS.cursorStyle),
    cursorBlink: getSetting<boolean>(TKEYS.cursorBlink, TERMINAL_DEFAULTS.cursorBlink),
    scrollback: getSetting<number>(TKEYS.scrollback, TERMINAL_DEFAULTS.scrollback),
    // 심화(#941)
    fontWeight: getSetting<TerminalFontWeight>(TKEYS.fontWeight, TERMINAL_DEFAULTS.fontWeight),
    scrollSensitivity: getSetting<number>(TKEYS.scrollSensitivity, TERMINAL_DEFAULTS.scrollSensitivity),
    macOptionIsMeta: getSetting<boolean>(TKEYS.macOptionIsMeta, TERMINAL_DEFAULTS.macOptionIsMeta),
  };
}

// 터미널 링크(#1193) — ⌘+클릭(맥)/Ctrl+클릭으로 엶. 그냥 클릭은 선택·복사용 그대로. 여는 일은 그 레포 화면(WorkspaceView)이 함.
export const TERMINAL_LINK_EVENT = "mustard:terminal-link";
export type TerminalLinkDetail = { cwd: string } & ({ kind: "url"; url: string } | { kind: "file"; path: string; line?: number });
const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const withMod = (ev: MouseEvent) => (isMac ? ev.metaKey : ev.ctrlKey);
function openTerminalLink(cwd: string, l: TerminalLink | { kind: "url"; url: string }) {
  if (l.kind === "url" && getSetting<string>(TKEYS.linkTarget, TERMINAL_DEFAULTS.linkTarget) === "external") { void window.nunopiDesktop?.openExternal?.(l.url); return; }
  const detail: TerminalLinkDetail = l.kind === "url" ? { cwd, kind: "url", url: l.url } : { cwd, kind: "file", path: l.path, line: l.line };
  window.dispatchEvent(new CustomEvent(TERMINAL_LINK_EVENT, { detail }));
}
// 버퍼 한 줄 → 글자와 "글자 위치 → 화면 칸" 표(한글·이모지는 두 칸이라 문자열 위치와 칸이 다름)
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

// 터미널 팔레트(#914·#956) — 앱 테마와 분리된 자체 색. CLI TUI가 다크 전제.
// 다크=near-black 배경(앱 다크와 통일, #956), 그레이=차콜,
// 라이트=Tango 라이트. ANSI 16색은 다크/그레이 공유(검정 배경서도 잘 보임).
const TERM_ANSI_DARK = {
  black: "#1d1f21", red: "#cc6666", green: "#b5bd68", yellow: "#f0c674", blue: "#81a2be", magenta: "#b294bb", cyan: "#8abeb7", white: "#c5c8c6",
  brightBlack: "#666666", brightRed: "#d54e53", brightGreen: "#b9ca4a", brightYellow: "#e7c547", brightBlue: "#7aa6da", brightMagenta: "#c397d8", brightCyan: "#70c0b1", brightWhite: "#eaeaea",
};
const TERM_DARK = {
  background: "#0a0a0a", foreground: "#ffffff", cursor: "#ffffff", cursorAccent: "#0a0a0a", selectionBackground: "#333333",
  ...TERM_ANSI_DARK,
};
const TERM_GRAY = {
  background: "#282c34", foreground: "#ffffff", cursor: "#ffffff", cursorAccent: "#282c34", selectionBackground: "#3e4451",
  ...TERM_ANSI_DARK,
};
const TERM_LIGHT = {
  background: "#ffffff", foreground: "#2e3434", cursor: "#2e3434", cursorAccent: "#ffffff", selectionBackground: "#accef7",
  black: "#2e3436", red: "#cc0000", green: "#4e9a06", yellow: "#8e7700", blue: "#3465a4", magenta: "#75507b", cyan: "#05727e", white: "#6a6a6a",
  brightBlack: "#555753", brightRed: "#ef2929", brightGreen: "#1b7a1b", brightYellow: "#6d5a00", brightBlue: "#204a87", brightMagenta: "#ad7fa8", brightCyan: "#034b50", brightWhite: "#3d3d3d",
};
function buildTermTheme() {
  const pref = getTerminalThemePref();
  if (pref === "light") return TERM_LIGHT;
  if (pref === "gray") return TERM_GRAY;
  if (pref === "dark") return TERM_DARK;
  return isTerminalDark(pref) ? TERM_DARK : TERM_LIGHT; // auto: 앱 다크면 검정
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
    let selDisp: { dispose(): void } | null = null;
    let linkDisp: { dispose(): void } | null = null;
    let oscDisp: { dispose(): void } | null = null;
    // 셸의 지금 폴더 — 셸이 OSC 7(file://호스트/경로)을 보내면 따라감(cd 뒤 상대 경로 링크용, 리뷰). 안 보내면 터미널을 연 폴더.
    let shellCwd = cwd;
    // #1027 ⌘K(터미널 포커스) = 화면 지우기 — 포커스가 이 터미널 안일 때만 처리(다른 터미널·탭이면 false로 넘김).
    const offClear = registerShortcut(["term.clear"], () => { if (!term || !host.contains(document.activeElement)) return false; term.clear(); });
    let onCtx: ((e: MouseEvent) => void) | null = null;
    let onEnter: (() => void) | null = null;
    let fallback: ReturnType<typeof setTimeout> | null = null;
    let onPaste: ((ev: ClipboardEvent) => void | Promise<void>) | undefined;

    (async () => {
      const [{ Terminal: XTerm }, { FitAddon }, webgl] = await Promise.all([
        import("@xterm/xterm"), import("@xterm/addon-fit"), import("@xterm/addon-webgl"),
      ]);
      if (disposed) return;
      // OSC 8 하이퍼링크(요즘 CLI가 찍는 숨은 링크)도 같은 규칙 — http(s)만
      term = new XTerm({ ...termOptionsFromSettings(), theme: buildTermTheme(), linkHandler: { activate: (ev, uri) => { if (withMod(ev) && /^https?:\/\//i.test(uri)) openTerminalLink(shellCwd, { kind: "url", url: uri }); } } });
      if (host) host.style.background = buildTermTheme().background;
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
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
            activate: (ev: MouseEvent) => { if (withMod(ev)) openTerminalLink(shellCwd, l); },
          }));
          cb(links.length ? links : undefined);
        },
      });
      // GPU(WebGL) 렌더 — 설정 gpu=false면 canvas 폴백(#926).
      if (getSetting<boolean>(TKEYS.gpu, TERMINAL_DEFAULTS.gpu)) {
        try {
          const gl = new webgl.WebglAddon();
          // #1165 GPU 프로세스가 다시 뜨면 WebGL 문맥이 사라짐 → 그대로 두면 글자 빠짐·흰 화면. 떼면 xterm이 기본(DOM) 렌더로 바꾸고 전체를 다시 그림.
          // 한계: 이 탭은 WebGL로 안 돌아감(GPU가 또 죽을 수 있음) — 새 탭부터 다시 WebGL.
          gl.onContextLoss(() => gl.dispose());
          term.loadAddon(gl);
        } catch { /* WebGL 미지원 → 기본 렌더 폴백 */ }
      }
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
        term.options.scrollSensitivity = o.scrollSensitivity;
        term.options.macOptionIsMeta = o.macOptionIsMeta;
        try { fit.fit(); } catch { /* ignore */ }
      };
      offSettings = subscribeSettings(applyTermSettings);
      // 선택 시 복사(copyOnSelect) / 우클릭 붙여넣기(rightClickPaste) — 설정 시.
      const onSelChange = () => { if (!term) return; if (!getSetting<boolean>(TKEYS.copyOnSelect, TERMINAL_DEFAULTS.copyOnSelect)) return; const sel = term.getSelection(); if (sel) navigator.clipboard?.writeText(sel).catch(() => {}); };
      onCtx = (e: MouseEvent) => { if (!getSetting<boolean>(TKEYS.rightClickPaste, TERMINAL_DEFAULTS.rightClickPaste)) return; e.preventDefault(); navigator.clipboard?.readText().then((txt) => { if (txt) nd.terminal.input({ id, data: txt }); }).catch(() => {}); };
      selDisp = term.onSelectionChange(onSelChange);
      host.addEventListener("contextmenu", onCtx);
      // 마우스 포커스(#941) — 설정 켜지면 호버 시 터미널 포커스.
      onEnter = () => { if (getSetting<boolean>(TKEYS.focusFollowsMouse, TERMINAL_DEFAULTS.focusFollowsMouse)) term?.focus(); };
      host.addEventListener("mouseenter", onEnter);
      // #973 터미널 벨 데스크톱 알림 제거 — 알림은 에이전트 ask/완료만(WorkspaceTabs). 터미널 벨 알림은 스팸이라 폐지.
      // 테마 라이브 전환(#914) — 터미널 설정(dark/light/auto) 변경 또는 auto일 때 앱 .dark 변경 시 색 갱신.
      const applyTermTheme = () => { const th = buildTermTheme(); if (term) term.options.theme = th; if (host) host.style.background = th.background; };
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

      // Shift+Enter(#799) — CSI-u(kitty/fixterms)로 인코딩된 "Shift+Enter" 키 이벤트를 전송.
      // \x1b[13;2u = Enter(13) + Shift 수정자(2). 에이전트 CLI(Claude Code 등)가 이를 진짜 개행 키로
      // 파싱해 멀티라인·백스페이스 정상(생 \n/ESC+CR은 리터럴로 오처리돼 1줄만/백스페이스 깨짐). false로 CR 제출 차단.
      term.attachCustomKeyEventHandler((e) => {
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
          const r = await nd.terminal.ensure({ id, cwd, cols: term.cols, rows: term.rows, dark: isTerminalDark(getTerminalThemePref()) });
          if (disposed || !term) return;
          if (!r.ok) { term.write(`\r\n[${tRef.current("terminal.startFailed", { reason: r.reason ? `: ${r.reason}` : "" })}]\r\n`); return; }
          if (r.buffer) term.write(stripTermQueries(r.buffer)); // 정확한 cols 확보 후 재생(줄바꿈 안 굳음). 질의 시퀀스 제거(에코 방지 #807)
          offData = nd.terminal.onData(({ id: i, data }) => { if (i === id && term) term.write(data); });
          // 셸 종료 시 빈 화면 방치 대신 안내(+로 새 터미널).
          offExit = nd.terminal.onExit(({ id: i }) => { if (i === id && term) term.write(`\r\n\x1b[2m${tRef.current("workspace.terminalExited")}\x1b[0m\r\n`); });
          term.onData((d) => nd.terminal.input({ id, data: d }));
        } catch {
          // 핸들러 미등록(옛 메인) 등 — 크래시 대신 안내.
          if (term && !disposed) term.write(`\r\n[${tRef.current("terminal.connectFailed")}]\r\n`);
        }
      };
      // 폭이 잡혔을 때만 fit → 최초 1회 ensure, 이후 resize. 폭 미확정이면 스킵(다음 콜백/폴백서 처리).
      const sync = () => {
        if (disposed || !term || host.clientWidth < MIN_W) return;
        try { fit.fit(); } catch { /* ignore */ }
        if (!ensured) { ensured = true; void firstEnsure(); }
        else { try { nd.terminal.resize({ id, cols: term.cols, rows: term.rows }); } catch { /* ignore */ } }
      };
      ro = new ResizeObserver(sync);
      ro.observe(host);
      requestAnimationFrame(sync); // 이미 폭이 잡혀 있으면 즉시 진행
      // 폭이 끝내 안 잡혀도(희귀) 터미널이 빈 채 방치되지 않게 폴백 — 최후엔 강제 ensure(데몬이 cols 하한 클램프).
      fallback = setTimeout(() => { if (!ensured && !disposed && term) { ensured = true; void firstEnsure(); } }, 1500);
    })();

    return () => { offClear(); disposed = true; if (fallback) clearTimeout(fallback); if (onPaste) host.removeEventListener("paste", onPaste, true); offData?.(); offExit?.(); ro?.disconnect(); mo?.disconnect(); offTheme?.(); offSettings?.(); selDisp?.dispose(); linkDisp?.dispose(); oscDisp?.dispose(); if (onCtx) host.removeEventListener("contextmenu", onCtx); if (onEnter) host.removeEventListener("mouseenter", onEnter); term?.dispose(); term = null; };
  }, [id, cwd]);

  // 초기 배경도 현재 터미널 테마에 맞춰(라이트 앱 첫 프레임 다크 깜빡임 방지). 클라이언트 전용 pane이라 안전.
  const initialBg = typeof document !== "undefined" ? buildTermTheme().background : "#0a0a0a"; // #956 pref별 배경(검정/그레이/흰색)
  return <div ref={hostRef} className="h-full w-full overflow-hidden p-1.5" style={{ background: initialBg }} />;
}
