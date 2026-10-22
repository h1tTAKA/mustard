// crewSandbox 점검 — node --experimental-strip-types src/lib/crew/crewSandbox.check.ts
// 실측(10-22, Claude Code 2.1.306, macOS 26.6.1): 이 설정 그대로 `claude -p --settings … --permission-mode bypassPermissions`로
// 임시 레포 worktree에서 셸 명령을 돌린 결과(샌드박스 없이 돌린 것과 비교).
//   막힘 ✓  worktree 밖(홈) 쓰기 · 원 레포 .git/hooks·.git/config 쓰기 · ~/.nunopi 읽기 · open(앱 실행) · launchctl · crontab
//          · 허용 목록 밖 사이트(strictAllowlist 넣은 뒤 — 없으면 '물어보기'라 bypassPermissions가 통과시킴)
//   됨  ✓  worktree 안 쓰기 · git commit(원 레포 .git objects·refs) · npm·GitHub 접속
//   못 막음 ✗  osascript(Apple Events로 다른 앱 조종) · security(키체인 조회) → crewPolicy auto에서도 사람에게 묻기
import assert from "node:assert";
import { ALLOWED_DOMAINS, sandboxSettings } from "./crewSandbox.ts";

const s = sandboxSettings({ worktree: "/w/repo-wt", gitDir: "/r/.git", home: "/Users/u", tmp: "/var/tmp" }).sandbox;
assert.deepStrictEqual([s.enabled, s.failIfUnavailable, s.allowUnsandboxedCommands], [true, true, false], "켜기·못 켜면 실패·밖으로 못 나감");
assert.strictEqual(s.network.strictAllowlist, true, "목록 밖은 막기(실측: 없으면 통과)");
assert.ok(ALLOWED_DOMAINS.includes("registry.npmjs.org") && ALLOWED_DOMAINS.includes("github.com") && !ALLOWED_DOMAINS.some((d) => d.includes("*")), "패키지·GitHub만, 와일드카드 없음");
assert.ok(s.filesystem.allowWrite.includes("/w/repo-wt") && s.filesystem.allowWrite.includes("/r/.git"), "worktree + 원 레포 git(커밋)");
assert.deepStrictEqual(s.filesystem.denyWrite, ["/r/.git/hooks", "/r/.git/config"], "레포 밖에서 실행되는 곳은 쓰기 금지");
for (const d of [".ssh", ".nunopi", ".claude", ".codex", ".config/gh", "Library/Keychains"]) assert.ok(s.filesystem.denyRead.includes(`/Users/u/${d}`), `비밀 읽기 금지: ${d}`);
assert.ok(!s.filesystem.allowWrite.includes("/Users/u"), "홈 전체 쓰기 아님");
assert.ok(!sandboxSettings({ worktree: "/w", gitDir: "/g", home: "/h" }).sandbox.filesystem.allowWrite.includes(undefined as unknown as string), "tmp 없으면 안 넣음");
console.log("crewSandbox.check ok");
