// resolveImport 별칭 해석 점검 — node --experimental-strip-types src/lib/repo/graphAlias.check.ts
import assert from "node:assert";
import { resolveImport, type AliasConf } from "./imports.ts";

const files = new Set(["src/lib/slack.ts", "lib/format.ts", "app/api/events/route.ts", "src/util/index.ts"]);

// nunopi식: @/* → ["src/*","*"]
const alias: AliasConf = { baseDir: "", rules: [{ prefix: "@/", suffix: "", wildcard: true, pattern: "@/*", targets: ["src/*", "*"] }] };

// @/lib/slack → src/lib/slack.ts (첫 타깃 src/* 매칭)
assert.equal(resolveImport("@/lib/slack", "app/api/events/route.ts", files, alias), "src/lib/slack.ts", "@/ → src/*");
// @/lib/format → lib/format.ts (src/lib/format 없음 → 둘째 타깃 *)
assert.equal(resolveImport("@/lib/format", "app/x.ts", files, alias), "lib/format.ts", "@/ → * 폴백");
// @/util → src/util/index.ts (인덱스 해석)
assert.equal(resolveImport("@/util", "app/x.ts", files, alias), "src/util/index.ts", "@/ → index");
// 상대 여전히 동작
assert.equal(resolveImport("./slack", "src/lib/x.ts", files, alias), "src/lib/slack.ts", "상대 유지");
// 외부 패키지 → null
assert.equal(resolveImport("@vercel/functions", "app/x.ts", files, alias), null, "패키지 null");
// 별칭 없으면 상대만
assert.equal(resolveImport("@/lib/slack", "app/x.ts", files, undefined), null, "별칭 conf 없으면 null");

console.log("graphAlias.check OK");

// #1331 모노레포 — 가장 가까운 tsconfig(+extends) + 워크스페이스 패키지
{
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { aliasFinder, workspacePackages, resolveWorkspace } = await import("./imports.ts");
  const r = mkdtempSync(join(tmpdir(), "alias-mono-"));
  const put = (rel: string, body: string) => { const p = join(r, rel); mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, body); };
  put("package.json", JSON.stringify({ workspaces: ["apps/*", "packages/*"] }));
  put("tsconfig.base.json", JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "~shared/*": ["packages/shared/src/*"] } } }));
  put("apps/web/tsconfig.json", JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }));
  put("apps/api/tsconfig.json", JSON.stringify({ extends: "../../tsconfig.base.json" }));
  put("packages/shared/package.json", JSON.stringify({ name: "@acme/shared", main: "./dist/index.js" }));
  const fs2 = new Set(["apps/web/src/lib/a.ts", "apps/web/src/page.tsx", "apps/api/src/x.ts", "packages/shared/src/index.ts", "packages/shared/src/util.ts"]);
  const al = aliasFinder(r);
  assert.equal(resolveImport("@/lib/a", "apps/web/src/page.tsx", fs2, al("apps/web/src/page.tsx") ?? undefined), "apps/web/src/lib/a.ts");
  assert.equal(resolveImport("~shared/util", "apps/api/src/x.ts", fs2, al("apps/api/src/x.ts") ?? undefined), "packages/shared/src/util.ts"); // extends로 물려받음
  const ws = workspacePackages(r);
  assert.equal(resolveWorkspace("@acme/shared", ws, fs2), "packages/shared/src/index.ts"); // dist → src 진입
  assert.equal(resolveWorkspace("@acme/shared/util", ws, fs2), "packages/shared/src/util.ts");
  assert.equal(resolveWorkspace("react", ws, fs2), null);
  console.log("alias monorepo ok");
}
