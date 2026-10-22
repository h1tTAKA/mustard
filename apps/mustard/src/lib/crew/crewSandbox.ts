// Crew '전부 알아서'(Auto, #1157) — Claude 역할에 넘길 Claude Code 자체 OS 샌드박스 설정(macOS Seatbelt, Bash 도구 대상). 순수(점검 가능).
// 문자열 규칙(crewPolicy)만으로는 셸을 빈틈없이 못 막음(#1137) → 쓰기·읽기·네트워크·앱 간 통신(XPC/Mach)을 OS가 막고, 그 위에서 셸을 자동 허락.
// 실측(10-22, Claude Code 2.1.306)은 crewSandbox.check.ts 머리 주석.
import { join } from "node:path";

// 패키지 설치 + GitHub 다운로드 전용 주소만(유저 결정). github.com·api.github.com은 뺌 — push·PR·gh API가 거기로 가서,
// 글자 검사로 못 막는 돌려 쓰기(g=git; $g push, python으로 git)도 네트워크에서 막힘. 대신 샌드박스 안 git clone/fetch 안 됨.
export const ALLOWED_DOMAINS = [
  "registry.npmjs.org", "registry.yarnpkg.com", "pypi.org", "files.pythonhosted.org",
  "codeload.github.com", "objects.githubusercontent.com", "raw.githubusercontent.com",
];

// 비밀·설정 — 셸이 읽어서 밖으로 실어 나르지 못하게(네트워크 허용 목록에 GitHub가 있으니 읽기 자체를 막음)
const SECRET_DIRS = [".ssh", ".aws", ".gnupg", ".config/gh", ".nunopi", ".claude", ".codex", ".netrc", ".npmrc", ".pypirc", ".docker", ".kube", "Library/Keychains"];

export interface SandboxInput { worktree: string; gitDir: string; home: string; tmp?: string }

export function sandboxSettings({ worktree, gitDir, home, tmp }: SandboxInput) {
  return {
    sandbox: {
      enabled: true,
      failIfUnavailable: true,          // 못 켜면 그냥 돌지 말고 시작 실패(조용히 샌드박스 없이 도는 게 최악)
      allowUnsandboxedCommands: false,  // 에이전트가 dangerouslyDisableSandbox로 빠져나가지 못하게
      autoAllowBashIfSandboxed: true,
      network: { allowedDomains: ALLOWED_DOMAINS, strictAllowlist: true }, // 목록 밖은 묻지 말고 막기(안 넣으면 '물어보기' → bypassPermissions가 통과시킴, 실측)
      filesystem: {
        // worktree + 원 레포 git 폴더(worktree 커밋은 여기 objects·refs에 씀) + 패키지 캐시·임시
        allowWrite: [worktree, gitDir, join(home, ".npm"), join(home, ".cache"), join(home, "Library/Caches"), ...(tmp ? [tmp] : [])],
        // 레포 밖(사람이 쓰는 git)에서 실행되는 곳 — hooks·config(core.hooksPath·sshCommand·pager)에 심으면 샌드박스 밖에서 돎
        denyWrite: [join(gitDir, "hooks"), join(gitDir, "config")],
        denyRead: SECRET_DIRS.map((d) => join(home, d)),
      },
    },
  };
}
