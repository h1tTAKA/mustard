"use client";
// #1224 터미널 링크 메뉴 — 링크 클릭 동작이 "메뉴"일 때 클릭한 자리에 띄움. 웹 주소 = 앱 안/외부로 열기·복사, 파일 = 열기·경로 복사.
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { IconBrowser, IconCopy, IconExternalLink, IconFile } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import type { TerminalLink } from "@/lib/terminalLinks";

export type TerminalLinkMenuState = { x: number; y: number; link: TerminalLink | { kind: "url"; url: string } };
const ITEM = "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-white/[0.08]";

export default function TerminalLinkMenu({ menu, onOpen, onClose }: { menu: TerminalLinkMenuState; onOpen: (external: boolean) => void; onClose: () => void }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e?: Event) => { if (e?.target instanceof Node && box.current?.contains(e.target)) return; onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" || e.metaKey || e.ctrlKey) onClose(); }; // ⌘/Ctrl 단축키(탭·레포 전환)로 화면이 바뀌면 메뉴가 남지 않게(리뷰)
    const id = setTimeout(() => { window.addEventListener("mousedown", close); window.addEventListener("resize", close); window.addEventListener("blur", onClose); }, 0); // 연 클릭이 바로 닫지 않게
    window.addEventListener("keydown", onKey, true); // capture — 단축키 실행기가 처리하며 전파를 멈춰도 받게
    box.current?.querySelector("button")?.focus();
    return () => { clearTimeout(id); window.removeEventListener("mousedown", close); window.removeEventListener("resize", close); window.removeEventListener("blur", onClose); window.removeEventListener("keydown", onKey, true); };
  }, [onClose]);
  const { link } = menu;
  const text = link.kind === "url" ? link.url : link.path;
  const pick = (fn: () => void) => () => { onClose(); fn(); };
  const copy = () => void navigator.clipboard?.writeText(text).catch(() => {});
  const left = Math.max(4, Math.min(menu.x, window.innerWidth - 240)), top = Math.max(4, Math.min(menu.y, window.innerHeight - 140)); // 화면 밖으로 안 나가게
  return createPortal(
    <div ref={box} role="menu" aria-label={text} onMouseDown={(e) => e.stopPropagation()} style={{ left, top }}
      className="fixed z-50 w-56 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-[var(--s-menu)] dark:ring-white/5">
      <div className="truncate px-2.5 pb-1 pt-1 font-mono text-[10.5px] text-zinc-400 dark:text-zinc-500" title={text}>{text}</div>
      {link.kind === "url" ? (
        <>
          <button type="button" role="menuitem" onClick={pick(() => onOpen(false))} className={ITEM}><IconBrowser size={14} stroke={1.75} className="shrink-0 text-zinc-400" aria-hidden />{t("term.linkOpenApp")}</button>
          <button type="button" role="menuitem" onClick={pick(() => onOpen(true))} className={ITEM}><IconExternalLink size={14} stroke={1.75} className="shrink-0 text-zinc-400" aria-hidden />{t("term.linkOpenExternal")}</button>
          <button type="button" role="menuitem" onClick={pick(copy)} className={ITEM}><IconCopy size={14} stroke={1.75} className="shrink-0 text-zinc-400" aria-hidden />{t("term.linkCopy")}</button>
        </>
      ) : (
        <>
          <button type="button" role="menuitem" onClick={pick(() => onOpen(false))} className={ITEM}><IconFile size={14} stroke={1.75} className="shrink-0 text-zinc-400" aria-hidden />{t("term.fileOpen")}</button>
          <button type="button" role="menuitem" onClick={pick(copy)} className={ITEM}><IconCopy size={14} stroke={1.75} className="shrink-0 text-zinc-400" aria-hidden />{t("term.pathCopy")}</button>
        </>
      )}
    </div>,
    document.body,
  );
}
