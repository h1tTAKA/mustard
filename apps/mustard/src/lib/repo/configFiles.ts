// 코드 그래프의 설정 파일(#1335) — 정해진 이름만 노드로(모든 json/yaml X: 데이터 JSON·키 노드는 폭증). kind는 file, role "config".
// 연결은 graph.ts가 매니페스트를 읽어 레포 안 패키지·extends·진입 파일로(외부 의존은 버림).
const NAMES = new Set([
  "package.json", "pnpm-workspace.yaml", "jsconfig.json", "pubspec.yaml", "go.mod", "go.work", "cargo.toml", "pyproject.toml",
  "composer.json", "pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts", "info.plist",
  "androidmanifest.xml", "docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml", "deno.json", "vercel.json", "turbo.json", "nx.json",
]);
// tsconfig.app.json 같은 변형, 도구 설정(next.config.mjs 등), .csproj·.entitlements
const PATTERNS = [/^tsconfig(\.[\w-]+)?\.json$/, /^(next|vite|vitest|webpack|rollup|svelte|nuxt|astro|tailwind|postcss|babel|jest|playwright|eslint|prettier)\.config\.(js|cjs|mjs|ts|cts|mts|json)$/, /\.(csproj|fsproj|entitlements)$/];
// 잠금 파일·비밀 — 이름이 위에 걸려도 제외
const DENY = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|cargo\.lock|poetry\.lock|go\.sum|composer\.lock|gemfile\.lock|pubspec\.lock|[^/]*\.lock|\.env[^/]*)$/i;

export function isConfigFile(rel: string): boolean {
  if (DENY.test(rel)) return false;
  const name = rel.slice(rel.lastIndexOf("/") + 1).toLowerCase();
  if (NAMES.has(name) || PATTERNS.some((p) => p.test(name))) return true;
  return /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i.test(rel); // CI 흐름
}
export const CONFIG_MAX_BYTES = 1024 * 1024; // 1MiB 넘는 설정 파일은 노드로 안 씀(생성물일 확률)
