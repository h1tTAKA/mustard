"use client";
// 워크스페이스 파일트리(#647) — scan이 준 flat 경로 목록을 중첩 트리로. 폴더 접기 + 파일 클릭.
import { useEffect, useMemo, useRef, useState } from "react";
import { IconChevronRight } from "@tabler/icons-react";
import { fileGlyph, folderGlyph } from "@/lib/repo/fileIcon";

interface TreeNode { name: string; path: string; children?: TreeNode[] } // children 있으면 폴더

function buildTree(files: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };
  for (const f of files) {
    const parts = f.split("/");
    let cur = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");
      let child = cur.children!.find((c) => c.name === part && !!c.children !== isFile);
      if (!child) { child = isFile ? { name: part, path } : { name: part, path, children: [] }; cur.children!.push(child); }
      cur = child;
    });
  }
  const sortNode = (n: TreeNode) => {
    if (!n.children) return;
    // 폴더 먼저, 그 안에서 자연 정렬(numeric) — Issue36 < Issue359 < Issue360(사전순이면 뒤죽박죽, #701).
    n.children.sort((a, b) => (b.children ? 1 : 0) - (a.children ? 1 : 0) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    n.children.forEach(sortNode);
  };
  sortNode(root);
  return root.children!;
}

// 변경 상태 도트 — 초록=신규, 노랑=수정(#687).
function StatusDot({ kind }: { kind: "added" | "modified" }) {
  return <span className={`ml-auto mr-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${kind === "added" ? "bg-emerald-500" : "bg-amber-500"}`} aria-hidden />;
}

function Node({ node, depth, open, toggle, selected, onSelect, status, folderStatus }: {
  node: TreeNode; depth: number; open: Set<string>; toggle: (p: string) => void; selected: string | null; onSelect: (p: string) => void; status: Record<string, "added" | "modified">; folderStatus: Record<string, "added" | "modified">;
}) {
  const pad = { paddingLeft: `${depth * 12 + 6}px` };
  if (node.children) {
    const isOpen = open.has(node.path);
    const fdot = folderStatus[node.path];
    return (
      <>
        <button type="button" onClick={() => toggle(node.path)} style={pad}
          className="flex w-full items-center gap-1 py-0.5 pr-1.5 text-left text-[12px] text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
          <IconChevronRight size={12} stroke={2} className={`shrink-0 text-zinc-400 transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden />
          {folderGlyph(node.name, isOpen)}
          <span className="truncate">{node.name}</span>
          {!isOpen && fdot && <StatusDot kind={fdot} />}
        </button>
        {isOpen && node.children.map((c) => <Node key={c.path} node={c} depth={depth + 1} open={open} toggle={toggle} selected={selected} onSelect={onSelect} status={status} folderStatus={folderStatus} />)}
      </>
    );
  }
  const on = selected === node.path;
  const dot = status[node.path];
  return (
    <button type="button" onClick={() => onSelect(node.path)} style={pad} data-path={node.path}
      className={`flex w-full items-center gap-1 py-0.5 pr-1.5 text-left text-[12px] transition ${on ? "bg-mustard-500/15 text-mustard-700 dark:bg-mustard-400/15 dark:text-mustard-400" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}>
      <span className="ml-[13px] flex shrink-0">{fileGlyph(node.name)}</span>
      <span className="truncate">{node.name}</span>
      {dot && <StatusDot kind={dot} />}
    </button>
  );
}

// reveal(#1322) = 바깥(둘러보기)에서 가리킨 파일 — 조상 폴더를 펼치고 그 줄로 스크롤. n은 같은 파일을 다시 가리킬 때도 동작하게.
export default function FileTree({ files, selected, onSelect, status = {}, storageKey, reveal }: { files: string[]; selected: string | null; onSelect: (path: string) => void; status?: Record<string, "added" | "modified">; storageKey?: string; reveal?: { file: string; n: number } | null }) {
  const tree = useMemo(() => buildTree(files), [files]);
  // 변경 파일의 조상 폴더별 집계(modified 우선) + 변경 포함 폴더 경로 집합(자동 펼침용).
  const { folderStatus, changedAncestors } = useMemo(() => {
    const fs: Record<string, "added" | "modified"> = {};
    const anc = new Set<string>();
    for (const [p, kind] of Object.entries(status)) {
      const parts = p.split("/");
      for (let i = 0; i < parts.length - 1; i++) {
        const dir = parts.slice(0, i + 1).join("/");
        anc.add(dir);
        if (kind === "modified") fs[dir] = "modified"; else if (!fs[dir]) fs[dir] = "added"; // modified가 added 이김
      }
    }
    return { folderStatus: fs, changedAncestors: anc };
  }, [status]);
  // 기본 접힘 — 변경사항 있는 파일의 조상 폴더만 펼친 채 시작(그 파일이 어디 있는지 바로 보이게). 그 외엔 유저가 열 때까지 접힘(#709).
  // status가 아직 안 왔으면 빈 셋으로 시작하고, 아래 useEffect가 로드 시 변경 폴더를 펼친다. 문서 브라우저는 status 없어 전부 접힘.
  const [open, setOpen] = useState<Set<string>>(() => new Set(changedAncestors));
  const toggle = (p: string) => setOpen((prev) => { const n = new Set(prev); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  // 변경 파일이 있는 폴더는 자동으로 펼쳐 그 파일이 드러나게(status 로드 시). 유저 접기는 안 덮게 union만.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- status 변경 시 변경 조상 폴더 펼침(union)
  useEffect(() => { if (changedAncestors.size) setOpen((prev) => { const n = new Set(prev); for (const p of changedAncestors) n.add(p); return n; }); }, [changedAncestors]);
  // 펼침 상태 영속(#712) — storageKey 있으면 마운트 시 저장분 복원(union), 이후 변경 시 저장. restoredRef로 복원 전 저장(빈 덮어쓰기) 방지.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!storageKey) { restoredRef.current = true; return; }
    try {
      const s = JSON.parse(localStorage.getItem(storageKey) || "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 저장된 펼침 복원(1회, union)
      if (Array.isArray(s)) setOpen((prev) => new Set([...prev, ...s.filter((x): x is string => typeof x === "string")]));
    } catch { /* ignore */ }
    restoredRef.current = true;
  }, [storageKey]);
  useEffect(() => { if (!restoredRef.current || !storageKey) return; try { localStorage.setItem(storageKey, JSON.stringify([...open])); } catch { /* ignore */ } }, [open, storageKey]);
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!reveal) return;
    const parts = reveal.file.split("/");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 가리킨 파일의 조상 폴더 펼침(union)
    setOpen((prev) => { const n = new Set(prev); for (let i = 1; i < parts.length; i++) n.add(parts.slice(0, i).join("/")); return n; });
    const id = requestAnimationFrame(() => boxRef.current?.querySelector(`[data-path="${CSS.escape(reveal.file)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
    return () => cancelAnimationFrame(id);
  }, [reveal]);
  return (
    <div ref={boxRef} className="nunopi-scroll h-full overflow-auto py-1">
      {tree.map((n) => <Node key={n.path} node={n} depth={0} open={open} toggle={toggle} selected={selected} onSelect={onSelect} status={status} folderStatus={folderStatus} />)}
    </div>
  );
}
