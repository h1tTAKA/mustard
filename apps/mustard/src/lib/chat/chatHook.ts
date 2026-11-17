// #1358 채팅 Claude 권한 훅 소스(Crew 훅 HOOK_SRC를 받아 바꿈) — 순수 함수라 점검에서 실제로 돌려 봄.
// 채팅 Claude 훅 — Crew 훅과 같되, 앱(Next)에 못 닿으면 바로 거절하지 않고 훅 제한 시간(900초) 안에서 다시 시도(#1358):
// 앱을 닫아도 채팅은 계속 도는데, 그동안 물어볼 도구가 오면 앱이 다시 열릴 때까지 기다렸다가 평소처럼 카드로. 끝내 안 열리면 이유를 달아 거절.
// 앱에 못 닿을 때 바로 허용하는 건 할 일 목록(TodoWrite)과 "전부 허용" 모드 채팅(물을 필요가 없는 모드 — 실측: 이걸 안 하면 앱이 꺼진 동안 파일 쓰기에서 멈춤)뿐 — 읽기 도구도 정책은 비밀 경로(.env·~/.ssh 등)면 사람에게 묻는데, 훅만으로는 그 판단을 못 해 앱을 기다림(리뷰).
// 앱에 못 닿을 때 이 채팅이 "전부 허용" 모드인지 — 훅 옆(채팅 저장 폴더)의 채팅 파일을 직접 읽음(토큰이 맞을 때만). 모드를 바꾸면 파일도 바뀌어 따라감.
const FULL_MODE_SRC = `const fullMode = () => { try { if (!/^[a-f0-9-]{36}$/.test(arg("run"))) return false; const fs = require("node:fs"), path = require("node:path"); for (const d of fs.readdirSync(__dirname)) { const f = path.join(__dirname, d, arg("run") + ".json"); if (!fs.existsSync(f)) continue; const j = JSON.parse(fs.readFileSync(f, "utf8")); return j.mode === "full" && j.token === arg("token"); } } catch {} return false; };
`;
export const chatHookSrc = (base: string) => base
  .replace("/api/crew/permission", "/api/chat/permission")
  .replace("Mustard Crew PreToolUse", "Mustard chat PreToolUse")
  .replace("let raw = \"\";", FULL_MODE_SRC + "let raw = \"\";")
  .replace(/const r = await fetch\(([\s\S]*?)\);\n/, (_m: string, a: string) => `const end = Date.now() + 870000; let r;
    for (;;) { try { r = await fetch(${a.replace("AbortSignal.timeout(900000)", "AbortSignal.timeout(Math.max(1000, end - Date.now()))")}); break; }
      catch (e) { if (input.tool_name === "TodoWrite" || fullMode()) out("allow"); if (Date.now() > end - 3000 || (e && e.name === "TimeoutError")) throw new Error("Mustard app was closed — no one to approve"); await new Promise((s) => setTimeout(s, 3000)); } }
`);
