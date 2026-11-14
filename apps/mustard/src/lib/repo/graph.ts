// 레포 그래프 빌더(#842 서브1) — 서버(Node) 전용. 흩어진 조각을 조립: scan(파일) + import 파싱(langs)
// + 심볼/호출 추출(symbols) → RepoGraph{nodes,edges}. 파싱은 전부 WASM tree-sitter(treesitter.ts, 네이티브 없음).
// 정확도 강화(scope-aware 해석·관계 확장)는 후속 커밋서 resolveCalls/추출 보강.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scanRepo, type ScanResult } from "./scan";
import { detectLang } from "./langs";
import { extractSymbols, resolveCalls, type SymbolInfo, type RawCall } from "./symbols";
import type { RepoGraph, RepoNode, RepoEdge, RepoAssetRole } from "./types";
import { fileHash, fileSig, type FileCache, type ParsedFile } from "./incremental";
import { readFileCache, writeFileCache } from "./graphStore";
import { isConfigFile } from "./configFiles";
import { configEdges } from "./configEdges";
import { detectCommunities } from "./communities";

// import 해석(상대 + tsconfig 별칭 + baseUrl)은 경량 모듈 imports.ts로 분리.
import { resolveImport, resolvePythonBare, aliasFinder, workspacePackages, resolveWorkspace, dirIndex, resolveJvmImport, resolveGoImport, goModulePath, dartPackages, resolveDartPackage, resolveElixir, JVM_RE, GO_RE, SWIFT_RE } from "./imports";
import { godotEdges, isGodotFile } from "./godotAssets";
import { isUnityAsset, underUnityAssets, unityGuidRefs, unityMetaGuid, unityRelation } from "./unityAssets";
import { csharpNamespaceAt, csharpTypeRefs, isEngineStub, stripCsharp, type TypeDef } from "./typeRefs";

// bare import 위로 찾기는 같은 언어 파일만(ruby require "x"가 x.py에 붙지 않게, 리뷰)
const sameLang = (from: string, hit: string | null) => (hit && hit.slice(hit.lastIndexOf(".")) === from.slice(from.lastIndexOf(".")) ? hit : null);
// 파일명(경로 마지막) — 노드 label용.
const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** 레포 루트 → RepoGraph. 파일 노드 + import 엣지 + 심볼 노드 + contains + calls. */
// 게임 에셋 역할(#1013) — Godot .tscn은 프리팹 역할도 하지만 형식상 씬.
function assetRole(file: string): RepoAssetRole | undefined {
  if (isConfigFile(file)) return "config"; // #1335
  const f = file.toLowerCase();
  if (f.endsWith(".unity") || f.endsWith(".tscn")) return "scene";
  if (f.endsWith(".prefab")) return "prefab";
  if (f.endsWith(".asset") || f.endsWith(".tres")) return "asset";
  return undefined;
}

export async function buildRepoGraph(root: string, pre?: ScanResult): Promise<RepoGraph> {
  const scan = pre ?? scanRepo(root); // 라우트가 이미 스캔했으면 재사용(이중 스캔 방지, #845 🟡)
  const fileSet = new Set(scan.files);
  const aliasOf = aliasFinder(root); // #1331 파일마다 가장 가까운 tsconfig(+extends) paths 별칭 — 모노레포 앱별 @/
  const wsPkgs = workspacePackages(root); // #1331 워크스페이스 패키지 이름(@scope/pkg) → 폴더
  // #1023 JVM·Go — 패키지 경로 import 해석용 폴더 인덱스 + go.mod 모듈 경로(루트). 같은 폴더 = 같은 패키지.
  const jvmDirs = dirIndex(scan.files, JVM_RE);
  const goDirs = dirIndex(scan.files, GO_RE);
  const swiftDirs = dirIndex(scan.files, SWIFT_RE); // #1331 Swift는 모듈(대개 타깃 폴더) 안 파일끼리 import 없이 서로 씀
  let goModule: string | null = null;
  if (goDirs.size) { try { goModule = goModulePath(readFileSync(join(root, "go.mod"), "utf8")); } catch { /* go.mod 없음 */ } }
  const dartPkgs = dartPackages(root, scan.files); // #1331 package:이름/ → 그 패키지 lib/

  const fileNodes: RepoNode[] = [];
  const symbolNodes: RepoNode[] = [];
  const edges: RepoEdge[] = [];
  const importEdges: RepoEdge[] = [];

  // 파일별 심볼(resolveCalls용)·원시호출·import 대상. 두 패스: (1) 추출 (2) 호출 해석(이웃 심볼 필요).
  const symbolsByFile = new Map<string, SymbolInfo[]>();
  const callsByFile = new Map<string, RawCall[]>();
  const heritageByFile = new Map<string, { classId: string; baseName: string; relation: "extends" | "implements" }[]>();
  const importTargetsByFile = new Map<string, string[]>(); // fromFile → 해석된 대상 파일들
  const csText = new Map<string, string>(); // #1005 C# 본문(타입 참조 2패스용)
  const unityText = new Map<string, string>(); // #1009 Unity 에셋 YAML(GUID 패스용)
  const godotText = new Map<string, string>(); // #1011 Godot .gd/.tscn/.tres(res:// 패스용)

  // #1320 파일별 파싱 캐시 — 내용 해시가 같으면 지난 import 지정자·심볼 추출을 그대로(tree-sitter 생략).
  const prev = readFileCache(root);
  const cache: FileCache = Object.create(null); // 파일 이름이 "constructor"여도 프로토타입과 안 섞이게(리뷰)
  let reparsed = 0;
  for (const file of scan.files) {
    const role = assetRole(file);
    fileNodes.push({ id: file, label: baseName(file), file, kind: "file", ...(role ? { role } : {}) });
    let text: string;
    // 못 읽은 파일(삭제 레이스 등)은 지난 캐시를 그대로 넘김 — 스냅샷에서 "지워짐"으로 오판해 흐름 노드가 빠지지 않게(리뷰).
    try { text = readFileSync(join(root, file), "utf8"); } catch { if (prev[file]) cache[file] = prev[file]; continue; }

    const hash = fileHash(text);
    const hit = prev[file]?.hash === hash ? prev[file] : null;
    const pf: ParsedFile = hit ?? { hash, sig: "" };

    // import 엣지(파일→파일). langs.extract가 지정자 목록 반환(TS compiler·Py·Go 등).
    const lang = detectLang(file);
    if (lang) {
      const targets: string[] = [];
      let specs: string[] = [];
      if (hit) specs = hit.specs ?? [];
      else { try { specs = lang.extract(text); } catch { specs = []; } pf.specs = specs; }
      const isJvm = JVM_RE.test(file), isGo = GO_RE.test(file), isSwift = SWIFT_RE.test(file);
      const seenT = new Set<string>();
      for (const spec of specs) {
        const one = spec.startsWith("package:") ? resolveDartPackage(spec, dartPkgs, fileSet)
          : spec.startsWith("ex:") ? resolveElixir(spec, scan.files)
          : resolveImport(spec, file, fileSet, aliasOf(file) ?? undefined) ?? (/\.(py|lua|rb)$/.test(file) ? sameLang(file, resolvePythonBare(spec, file, fileSet)) : null) ?? (wsPkgs.size ? resolveWorkspace(spec, wsPkgs, fileSet) : null);
        // #1023 상대·별칭으로 못 풀면 JVM FQN / Go 모듈 경로(패키지=폴더 → 여러 파일)
        const ts = one ? [one] : isJvm ? resolveJvmImport(spec, jvmDirs) : isGo ? resolveGoImport(spec, goModule, goDirs) : [];
        for (const target of ts) {
          if (target === file || seenT.has(target)) continue;
          seenT.add(target);
          importEdges.push({ source: file, target, relation: "imports" });
          targets.push(target);
        }
      }
      // #1023 같은 패키지(같은 폴더, JVM은 java+kt) 형제는 import 없이 서로 씀 → 엣지 없이 해석 대상에만(calls·상속이 패키지 안 파일을 넘게).
      if (isJvm || isGo || isSwift) {
        const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
        for (const sib of (isJvm ? jvmDirs : isGo ? goDirs : swiftDirs).get(dir) ?? []) if (sib !== file && !seenT.has(sib)) targets.push(sib);
      }
      importTargetsByFile.set(file, targets);
    }

    if (file.endsWith(".cs")) csText.set(file, text);
    const skip = isUnityAsset(file) || isGodotFile(file) || isConfigFile(file); // 설정 파일은 심볼 없음(#1335 — build.gradle.kts 등 코드 문법이어도)
    if (!skip && !hit) { try { pf.ex = await extractSymbols(text, file); } catch { pf.ex = undefined; } } // #1331 한 파일 실패가 그래프 전체를 죽이지 않게(심볼 없이 파일·import만)
    // 에셋(Unity·Godot)은 심볼이 없어 서명이 늘 같음 → 내용 해시를 서명으로(씬·프리팹 편집 = 연결 변화, 리뷰).
    if (!hit) { pf.sig = skip ? hash : fileSig(pf.specs, pf.ex?.symbols); reparsed++; }
    cache[file] = pf;
    if (isUnityAsset(file)) { unityText.set(file, text); continue; } // 에셋 YAML — 심볼·import 없음(GUID 패스에서 연결)
    if (isGodotFile(file)) { godotText.set(file, text); continue; } // GDScript 문법 없음 — 파일 단위 연결만(res:// 패스)
    // 심볼 노드 + contains + 원시호출(tree-sitter). 미지원 언어면 빈 결과.
    const ex = pf.ex ?? { symbols: [], nodes: [], contains: [], calls: [], heritage: [] };
    for (const n of ex.nodes) symbolNodes.push(n);
    for (const c of ex.contains) edges.push(c);
    symbolsByFile.set(file, ex.symbols);
    callsByFile.set(file, ex.calls);
    heritageByFile.set(file, ex.heritage);
  }

  // #1005 C# 타입 참조(1.5패스) — using이 네임스페이스라 import 엣지가 없음 → 레포 타입 인덱스(class/type 심볼 + 선언 ns)로
  // 본문에서 쓴 타입의 정의 파일에 references 엣지. 참조 파일을 import 대상처럼 취급 → 아래 calls·상속 해석이 파일을 넘나듦.
  if (csText.size) {
    const index = new Map<string, TypeDef[]>();
    for (const [file, text] of csText) {
      const clean = stripCsharp(text);
      if (isEngineStub(clean)) continue; // 엔진 흉내 스텁은 레포 밖 엔진 취급 — 인덱스 제외(파일 노드·자체 심볼은 유지)
      const nsAt = csharpNamespaceAt(clean); // 한 파일 여러 namespace — 심볼 행 기준(#1006 리뷰)
      for (const s of symbolsByFile.get(file) ?? []) {
        if (s.kind !== "class" && s.kind !== "type") continue;
        const a = index.get(s.name) ?? [];
        if (!a.some((d) => d.file === file)) a.push({ name: s.name, file, namespace: nsAt(s.startRow) });
        index.set(s.name, a);
      }
    }
    for (const [file, text] of csText) {
      const refs = csharpTypeRefs(file, text, index);
      if (!refs.length) continue;
      for (const target of refs) importEdges.push({ source: file, target, relation: "references" });
      importTargetsByFile.set(file, [...(importTargetsByFile.get(file) ?? []), ...refs]);
    }
  }

  // #1009 Unity 구조 — 스캔된 파일 옆 .meta로 GUID → 파일 사전, 씬/프리팹/에셋이 참조한 GUID를 파일로 풀어 uses·instantiates.
  // 레포 밖 GUID(Unity 내장·패키지)는 사전에 없어 자연히 빠짐. Unity 에셋이 없는 레포는 .meta를 읽지 않음.
  if (unityText.size) {
    const byGuid = new Map<string, string>();
    for (const file of scan.files) {
      if (!underUnityAssets(file)) continue;
      let meta: string;
      try { meta = readFileSync(join(root, `${file}.meta`), "utf8"); } catch { continue; }
      const guid = unityMetaGuid(meta);
      if (guid && !byGuid.has(guid)) byGuid.set(guid, file);
    }
    for (const [file, text] of unityText) {
      for (const guid of unityGuidRefs(text)) {
        const target = byGuid.get(guid);
        const relation = target && target !== file ? unityRelation(target) : null;
        if (relation) importEdges.push({ source: file, target: target!, relation });
      }
    }
  }

  // #1011 Godot 구조 — res:// 경로로 직접 참조(GUID 불필요). 씬/리소스 → uses·instantiates, GDScript → imports.
  if (godotText.size) for (const e of godotEdges(godotText, fileSet, scan.godotRoots)) importEdges.push(e);

  // calls 해석(2패스) — 파일별 로컬 심볼 + import한 파일들의 심볼 테이블로 대상 매칭.
  for (const file of scan.files) {
    const calls = callsByFile.get(file);
    if (!calls || !calls.length) continue;
    const local = symbolsByFile.get(file) ?? [];
    const imported = new Map<string, SymbolInfo[]>();
    for (const t of importTargetsByFile.get(file) ?? []) imported.set(t, symbolsByFile.get(t) ?? []);
    for (const e of resolveCalls(calls, local, imported)) edges.push(e);
  }

  // 상속(extends/implements) 해석 — baseName을 로컬 class 심볼 → import한 파일의 class 심볼 순으로 매칭(#843).
  for (const file of scan.files) {
    const hs = heritageByFile.get(file);
    if (!hs || !hs.length) continue;
    const localClass = new Map<string, string>(); // 이름 → class 심볼 id(로컬)
    for (const s of symbolsByFile.get(file) ?? []) if (s.kind === "class" && !localClass.has(s.name)) localClass.set(s.name, s.id);
    const importClass = new Map<string, string>();
    for (const t of importTargetsByFile.get(file) ?? []) for (const s of symbolsByFile.get(t) ?? []) if (s.kind === "class" && !importClass.has(s.name)) importClass.set(s.name, s.id);
    const seen = new Set<string>();
    for (const h of hs) {
      const target = localClass.get(h.baseName) ?? importClass.get(h.baseName);
      if (!target || target === h.classId) continue;
      const key = `${h.classId}|${target}|${h.relation}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: h.classId, target, relation: h.relation });
    }
  }

  writeFileCache(root, cache);
  const allEdges = [...importEdges, ...edges, ...configEdges(root, scan.files, fileSet, wsPkgs, dartPkgs)]; // #1335 설정 파일 연결
  // #1331 덩어리 — 파일 사이 실제 연결로 라벨 전파, 심볼은 자기 파일 덩어리
  const { communities, byFile } = detectCommunities([...fileNodes, ...symbolNodes], allEdges);
  const nodes = [...fileNodes, ...symbolNodes].map((n) => { const c = byFile.get(n.file); return c == null ? n : { ...n, community: c }; });
  return {
    root,
    nodes,
    edges: allEdges,
    communities,
    stats: {
      files: fileNodes.length,
      edges: allEdges.length,
      scanned: scan.files.length,
      capped: scan.capped,
      reparsed,
    },
  };
}
