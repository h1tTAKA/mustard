// 워크스페이스 파일트리 아이콘(#655) — 확장자·파일명·폴더명 → @tabler/icons-react 아이콘 + 언어별 색.
// 확장자별 파일 아이콘을 신규 dep 없이(이미 쓰는 tabler로) 근사.
// JSX 엘리먼트를 직접 반환 — 렌더 중 컴포넌트 변수 생성 금지(react-hooks/static-components).
import {
  IconFile, IconFolder, IconFolderOpen, IconFolderFilled,
  IconBrandTypescript, IconBrandJavascript, IconBrandReact, IconBrandDocker, IconBrandGit,
  IconBrandPython, IconBrandRust, IconBrandGolang, IconBrandVue, IconBrandPhp,
  IconBrandNextjs, IconBrandNodejs, IconBrandTailwind, IconBrandCss3, IconBrandHtml5,
  IconJson, IconMarkdown, IconSettings, IconTerminal2, IconDatabase, IconLock, IconPhoto,
  IconFileTypeZip, IconFileTypeTxt, IconFileTypePdf, IconFileTypeXml,
  type IconProps,
} from "@tabler/icons-react";

type Glyph = React.ComponentType<IconProps>;

// 아이콘+색을 실제 JSX로. 헬퍼는 모듈 스코프(렌더 밖)라 static-components 룰과 무관.
function paint(Icon: Glyph, color: string, size: number) {
  return <Icon size={size} stroke={2} className={`shrink-0 ${color}`} aria-hidden />;
}

// 파일명 → 아이콘 JSX. 특수 파일명(정확/접두 일치) 먼저, 그 다음 확장자.
export function fileGlyph(name: string, size = 13) {
  const lower = name.toLowerCase();
  // 1) 특수 파일명
  if (lower === "package.json" || lower === "package-lock.json" || lower === "pnpm-lock.yaml" || lower === "yarn.lock") return paint(IconJson, "text-amber-500", size);
  if (lower === "dockerfile" || lower.endsWith(".dockerignore")) return paint(IconBrandDocker, "text-sky-500", size);
  if (lower === ".gitignore" || lower === ".gitattributes" || lower === ".gitmodules") return paint(IconBrandGit, "text-orange-500", size);
  if (lower.startsWith("tsconfig")) return paint(IconBrandTypescript, "text-blue-500", size);
  if (lower.startsWith("tailwind.config")) return paint(IconBrandTailwind, "text-cyan-500", size);
  if (lower.startsWith("next.config")) return paint(IconBrandNextjs, "text-zinc-700 dark:text-zinc-200", size);
  if (lower.startsWith("readme")) return paint(IconMarkdown, "text-blue-400", size);
  if (lower.startsWith(".env")) return paint(IconSettings, "text-amber-400", size);
  // 2) 확장자
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  switch (ext) {
    case "ts": case "mts": case "cts": return paint(IconBrandTypescript, "text-blue-500", size);
    case "tsx": return paint(IconBrandReact, "text-blue-400", size);
    case "js": case "mjs": case "cjs": return paint(IconBrandJavascript, "text-amber-400", size);
    case "jsx": return paint(IconBrandReact, "text-sky-400", size);
    case "json": case "jsonc": return paint(IconJson, "text-amber-500", size);
    case "md": case "mdx": return paint(IconMarkdown, "text-blue-400", size);
    case "css": case "scss": case "sass": return paint(IconBrandCss3, "text-sky-500", size);
    case "html": case "htm": return paint(IconBrandHtml5, "text-orange-500", size);
    case "py": return paint(IconBrandPython, "text-blue-400", size);
    case "rs": return paint(IconBrandRust, "text-orange-600", size);
    case "go": return paint(IconBrandGolang, "text-cyan-500", size);
    case "vue": return paint(IconBrandVue, "text-emerald-500", size);
    case "php": return paint(IconBrandPhp, "text-indigo-400", size);
    case "sql": return paint(IconDatabase, "text-sky-400", size);
    case "yml": case "yaml": return paint(IconSettings, "text-rose-400", size);
    case "toml": case "ini": case "conf": case "config": return paint(IconSettings, "text-zinc-400", size);
    case "sh": case "bash": case "zsh": return paint(IconTerminal2, "text-emerald-500", size);
    case "lock": return paint(IconLock, "text-zinc-400", size);
    case "png": case "jpg": case "jpeg": case "gif": case "svg": case "webp": case "ico": return paint(IconPhoto, "text-purple-400", size);
    case "zip": case "tar": case "gz": case "tgz": return paint(IconFileTypeZip, "text-zinc-400", size);
    case "txt": return paint(IconFileTypeTxt, "text-zinc-400", size);
    case "pdf": return paint(IconFileTypePdf, "text-red-500", size);
    case "xml": return paint(IconFileTypeXml, "text-orange-400", size);
    default: return paint(IconFile, "text-zinc-400", size);
  }
}

// 폴더명 → 아이콘 JSX. 특수 폴더는 전용 아이콘·색, 그 외는 기본 열림/닫힘 폴더.
export function folderGlyph(name: string, isOpen: boolean, size = 13) {
  switch (name.toLowerCase()) {
    case "node_modules": return paint(IconBrandNodejs, "text-emerald-500", size);
    case "src": case "app": case "lib": return paint(IconFolderFilled, "text-emerald-500", size);
    case "dist": case "build": case "out": case ".next": return paint(IconFolderFilled, "text-zinc-400", size);
    case "coverage": return paint(IconFolderFilled, "text-lime-500", size);
    case "test": case "tests": case "__tests__": case "spec": return paint(IconFolderFilled, "text-teal-500", size);
    case "scripts": return paint(IconTerminal2, "text-yellow-500", size);
    case "public": case "assets": case "static": case "images": return paint(IconPhoto, "text-purple-400", size);
    case ".git": case ".github": return paint(IconBrandGit, "text-orange-500", size);
    default: return isOpen
      ? paint(IconFolderOpen, "text-mustard-600 dark:text-mustard-400", size)
      : paint(IconFolder, "text-zinc-400", size);
  }
}
