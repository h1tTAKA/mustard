// 받아쓰기 도우미(#1341) → dist/mustard-dictate (macOS). Swift 파일 하나라 swiftc로 바로. 서명은 임시(ad-hoc) — 패키징 때 앱 인증서로 다시 서명.
// Info.plist를 실행 파일 안(__TEXT,__info_plist)에 넣음 — 음성 인식은 그 프로세스 자신의 사용 설명을 봄. 없으면 권한을 묻기 전에 macOS가 죽임(실측 exit 134).
// 한계: 지금 맥의 아키텍처로만 빌드(패키징 대상이 mac-arm64 하나).
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist", "mustard-dictate");
const run = (cmd, args) => { const r = spawnSync(cmd, args, { cwd: here, stdio: "inherit" }); if (r.status !== 0) process.exit(r.status ?? 1); };
rmSync(out, { force: true }); // 빌드 실패 때 옛 파일이 패키징되지 않게
mkdirSync(dirname(out), { recursive: true });
run("xcrun", ["swiftc", "-O", "main.swift", "-o", out, "-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", join(here, "Info.plist")]);
run("codesign", ["--remove-signature", out]); // 아래에서 Info.plist를 묶어 다시 서명
run("codesign", ["--force", "--sign", "-", "--identifier", "ai.neuradex.mustard.dictation", out]);
console.log(`[dictation] ${out}`);
