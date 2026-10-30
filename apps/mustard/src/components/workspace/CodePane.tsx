"use client";
// 워크스페이스 코드칸(#647) — 파일 클릭 시 소스 읽어 shiki로 하이라이트(읽기전용). 다크 전환 대응.
import { langOf } from "@/lib/codeLang";
import { useEffect, useRef, useState } from "react";
import { codeToHtml } from "shiki";
import { IconLoader2, IconAlertTriangle, IconFileOff, IconZoomIn, IconZoomOut, IconArrowsMinimize, IconArrowsMaximize } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import { useCodeFont } from "@/lib/codeFont";

// 확장자 → shiki 언어. 없으면 text.
// 바이트 → 사람이 읽는 크기(#657 미리보기 안내용).
const fmtSize = (n: number) => n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
type BinaryInfo = { kind: "image" | "binary" | "non-utf8"; size: number; dataUrl?: string };


export default function CodePane({ root, file }: { root: string; file: string }) {
  const [html, setHtml] = useState<string>("");
  const [raw, setRaw] = useState<string>("");
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [isDark, setIsDark] = useState(false);
  const [bin, setBin] = useState<BinaryInfo | null>(null); // 텍스트 아닌 파일(#657)
  const t = useT();
  const font = useCodeFont(); // #1218 기본 12px·--font-mono

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDark(document.documentElement.classList.contains("dark"));
    const obs = new MutationObserver(() => setIsDark(document.documentElement.classList.contains("dark")));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 파일 바뀌면 로딩 리셋(마운트/키변경 시 1회)
    setStatus("loading"); setHtml(""); setRaw(""); setBin(null);
    (async () => {
      try {
        const r = await fetch("/api/repo/file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root, file }) });
        const d = await r.json();
        if (!r.ok) { if (!cancelled) setStatus("error"); return; }
        if (d.binary) { if (!cancelled) { setBin({ kind: d.kind, size: d.size ?? 0, dataUrl: d.dataUrl }); setStatus("ok"); } return; }
        const src: string = d.content ?? "";
        if (!cancelled) { setRaw(src); setStatus("ok"); }
      } catch { if (!cancelled) setStatus("error"); }
    })();
    return () => { cancelled = true; };
  }, [root, file]);

  // raw/테마 바뀌면 재하이라이트.
  useEffect(() => {
    if (status !== "ok" || bin) return;
    let cancelled = false;
    codeToHtml(raw, { lang: langOf(file), theme: isDark ? "github-dark" : "github-light" })
      .then((out) => { if (!cancelled) setHtml(out); })
      .catch(() => { if (!cancelled) setHtml(""); });
    return () => { cancelled = true; };
  }, [raw, file, isDark, status, bin]);

  if (status === "loading") return <div className="flex h-full items-center justify-center text-zinc-400"><IconLoader2 size={16} stroke={2} className="animate-spin" aria-hidden /></div>;
  if (status === "error") return <div className="flex h-full items-center justify-center gap-1.5 text-[12px] text-amber-600 dark:text-amber-500"><IconAlertTriangle size={14} stroke={2} aria-hidden /> {file}</div>;

  if (bin) {
    // 이미지면 가운데 미리보기 + 파일명·크기, 그 외(바이너리·비UTF-8·큰 이미지)는 안내 한 줄.
    if (bin.kind === "image" && bin.dataUrl) return <ImageView key={file} src={bin.dataUrl} name={file.split("/").pop() ?? file} size={bin.size} />;
    const key = bin.kind === "non-utf8" ? "code.nonUtf8" : bin.kind === "image" ? "code.imageTooBig" : "code.binary";
    return <div className="flex h-full items-center justify-center gap-1.5 text-[12px] text-zinc-400 dark:text-zinc-500"><IconFileOff size={14} stroke={2} aria-hidden /> {t(key, { size: fmtSize(bin.size) })}</div>;
  }

  return (
    <div style={font} className="nunopi-scroll h-full overflow-auto bg-white p-3 dark:bg-[var(--s-pane)] [&_pre]:!m-0 [&_pre]:!bg-transparent [&_pre]:[font-family:inherit]">
      {html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <pre className="text-zinc-700 dark:text-zinc-200">{raw}</pre>}
    </div>
  );
}

// 이미지 미리보기(#657) — 처음엔 칸에 맞춤(작은 이미지는 최대 8배까지 키움, 16px 아이콘이 점처럼 보이던 문제), +/− 버튼·⌘/Ctrl+휠(트랙패드 핀치)로 확대/축소,
// 확대 시 스크롤로 이동. 1배 초과는 픽셀 그대로(pixelated) 확대해 픽셀 아트·아이콘이 흐려지지 않게.
const ZMIN = 0.05, ZMAX = 32, ZSTEP = 1.25;
function ImageView({ src, name, size }: { src: string; name: string; size: number }) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fitted, setFitted] = useState(false); // 지금 배율이 "칸 맞춤"인지 — 맞춤 버튼을 맞춤↔100% 전환으로
  const zoomBy = (f: number) => { setFitted(false); setZoom((z) => clamp(z * f)); };
  const toggleFit = () => {
    if (fitted) { setFitted(false); setZoom(1); return; }
    const z = nat && fit(nat.w, nat.h);
    if (z) { setZoom(z); setFitted(true); }
  };
  const clamp = (z: number) => Math.min(ZMAX, Math.max(ZMIN, z));
  // 칸 맞춤 배율. 칸이 아직 배치 전(0 크기, 숨김 패널)이면 null → 현재 배율 유지(#1018 리뷰: 0 크기로 최소 배율 되던 것).
  const fit = (w: number, h: number): number | null => {
    const box = boxRef.current;
    const bw = (box?.clientWidth ?? 0) - 24, bh = (box?.clientHeight ?? 0) - 24;
    if (!w || !h || bw <= 0 || bh <= 0) return null;
    return clamp(Math.min(bw / w, bh / h, 8));
  };
  const measure = (img: HTMLImageElement) => { if (img.naturalWidth) setNat({ w: img.naturalWidth, h: img.naturalHeight }); };
  // 캐시된 이미지는 마운트 전에 로드가 끝나 onLoad가 안 올 수 있음 → 마운트 시 complete면 직접 측정(#1018 리뷰).
  useEffect(() => { const img = imgRef.current; if (img?.complete) measure(img); }, []);
  // 크기 알게 된 뒤 레이아웃이 잡힌 다음 프레임에 맞춤(onLoad 시점엔 칸 크기가 아직 0일 수 있음).
  useEffect(() => {
    if (!nat) return;
    const id = requestAnimationFrame(() => { const z = fit(nat.w, nat.h); if (z !== null) { setZoom(z); setFitted(true); } });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fit은 ref만 읽는 순수 계산, nat 바뀔 때만 1회
  }, [nat]);
  // ⌘/Ctrl+휠 = 확대/축소. React onWheel은 passive라 preventDefault(페이지 줌 막기)가 안 돼 직접 등록.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setFitted(false);
      setZoom((z) => clamp(e.deltaY < 0 ? z * 1.1 : z / 1.1));
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, []);
  const btn = "rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";
  return (
    <div className="flex h-full flex-col bg-white dark:bg-[var(--s-pane)]">
      <div ref={boxRef} className="nunopi-scroll flex min-h-0 flex-1 overflow-auto p-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL 미리보기라 next/image 최적화 불필요 */}
        <img ref={imgRef} src={src} alt={name} draggable={false} className="m-auto max-w-none"
          style={nat ? { width: nat.w * zoom, height: nat.h * zoom, imageRendering: zoom > 1 ? "pixelated" : "auto" } : { visibility: "hidden" }}
          onLoad={(e) => measure(e.currentTarget)} />
      </div>
      <div className="flex shrink-0 items-center justify-center gap-1 border-t border-zinc-200 px-2 py-1 text-[11px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
        <span className="mr-2 truncate">{name}{nat ? ` · ${nat.w}×${nat.h}` : ""} · {fmtSize(size)}</span>
        <button type="button" className={btn} onClick={() => zoomBy(1 / ZSTEP)} title={t("code.zoomOut")} aria-label={t("code.zoomOut")}><IconZoomOut size={14} stroke={2} /></button>
        <span className="w-11 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <button type="button" className={btn} onClick={() => zoomBy(ZSTEP)} title={t("code.zoomIn")} aria-label={t("code.zoomIn")}><IconZoomIn size={14} stroke={2} /></button>
        {/* 맞춤 ↔ 원래 크기(100%) 전환 — 맞춤 상태에서 눌러도 항상 변화가 있게(유저: 열자마자 누르면 무반응이라 고장 같음). */}
        <button type="button" className={btn} onClick={toggleFit} title={t(fitted ? "code.zoomActual" : "code.zoomFit")} aria-label={t(fitted ? "code.zoomActual" : "code.zoomFit")}>
          {fitted ? <IconArrowsMaximize size={14} stroke={2} /> : <IconArrowsMinimize size={14} stroke={2} />}
        </button>
      </div>
    </div>
  );
}
