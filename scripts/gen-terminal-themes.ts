// #1215 터미널 테마 목록 만들기 — iTerm2-Color-Schemes(MIT)의 ghostty/ 테마 파일 전부 → apps/mustard/public/terminal-themes.json
// 실행: node --experimental-strip-types scripts/gen-terminal-themes.ts   (git 필요, 원본은 임시 폴더에 얕게 받음)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completeColors, packTheme, parseGhosttyTheme } from "../packages/core/src/terminalThemes.ts";
import { isLightColor } from "../packages/core/src/terminalRender.ts";

const REPO = "https://github.com/mbadolato/iTerm2-Color-Schemes.git";
const dir = mkdtempSync(join(tmpdir(), "term-themes-"));
try {
  execFileSync("git", ["clone", "--depth", "1", "--filter=blob:none", "--sparse", REPO, dir], { stdio: "inherit" });
  execFileSync("git", ["-C", dir, "sparse-checkout", "set", "ghostty"], { stdio: "inherit" });
  const rev = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"]).toString().trim();
  const themes = readdirSync(join(dir, "ghostty")).sort((a, b) => a.localeCompare(b)).flatMap((name) => {
    const colors = completeColors(parseGhosttyTheme(readFileSync(join(dir, "ghostty", name), "utf8")), isLightColor);
    return colors ? [packTheme({ name, colors })] : [];
  });
  const out = {
    source: `${REPO.replace(/\.git$/, "")} @ ${rev} (ghostty/)`,
    license: "MIT License — Copyright (c) 2011 to Present Mark Badolato. Individual schemes credit their authors in the source repository.",
    themes,
  };
  writeFileSync("apps/mustard/public/terminal-themes.json", JSON.stringify(out));
  console.log(`terminal-themes.json: ${themes.length} themes`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
