// repo-watcher 무시 경로 점검(#1155) — node electron/repo-watcher.test.cjs
const assert = require("node:assert");
const { ignored } = require("./repo-watcher.cjs");

for (const p of ["node_modules/x/a.js", "apps/mustard/.next/cache/a", "dist/a.js", "apps/mustard/dist_electron/mac-arm64/x", "build/out.js", ".git/objects/ab/cd", ".git/logs/HEAD", "src/.DS_Store", "a\\node_modules\\b.js"])
  assert.ok(ignored(p), `무시: ${p}`);
for (const p of ["src/distance.ts", "src/redistribute/x.ts", "src/builder.ts", "src/dist.ts", ".git/HEAD", ".git/refs/heads/main", ".git/index", "docs/next.md", ""])
  assert.ok(!ignored(p), `반응: ${p}`);
console.log("repo-watcher.test ok");
