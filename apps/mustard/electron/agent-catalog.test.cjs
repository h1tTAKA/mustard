// agent-catalog 점검 — node electron/agent-catalog.test.cjs
const assert = require("node:assert");
const { AGENTS, BY_ID, choicesOf, launchLine, parseEnv, liftPermission, hasPermissionOption, identityBins, carriersOf, weakDetect } = require("./agent-catalog.cjs");

assert.strictEqual(AGENTS.length, 44, "카탈로그 44개(claude-agent-teams 제외)");
assert.strictEqual(new Set(AGENTS.map((a) => a.id)).size, AGENTS.length, "id 겹침 없음");
assert.ok(AGENTS.every((a) => a.label && a.cmd && /^https:\/\//.test(a.url) && a.bins.length), "필수 칸");
// 실행 명령 — 권한 플래그는 유저 인자 앞, own이면 안 붙음
assert.strictEqual(launchLine("claude"), "claude");
assert.strictEqual(launchLine("claude", { choice: "full-access", userArgs: "--model opus" }), "claude --dangerously-skip-permissions --model opus");
assert.strictEqual(launchLine("codex", { choice: "ask" }), "codex -a on-request -s workspace-write -c approvals_reviewer=user");
assert.strictEqual(launchLine("hermes", { choice: "full-access" }), "hermes --tui --yolo", "실행 명령(launch) 사용");
assert.strictEqual(launchLine("cursor", { choice: "auto" }), "cursor-agent", "지원 안 하는 모드 = 플래그 없음");
assert.strictEqual(launchLine("goose", { choice: "full-access" }), "GOOSE_MODE=auto goose", "env는 앞붙임");
assert.strictEqual(launchLine("goose", { choice: "full-access", userArgs: "GOOSE_MODE=chat" }), "goose GOOSE_MODE=chat", "유저 env가 이김");
assert.strictEqual(launchLine("claude", { choice: "full-access", cmd: "/x/claude" }), "/x/claude --dangerously-skip-permissions", "경로 지정");
assert.strictEqual(launchLine("nope"), null);
// 유저 인자에 권한 옵션이 있으면 안 붙임
assert.strictEqual(launchLine("claude", { choice: "full-access", userArgs: "--permission-mode plan" }), "claude --permission-mode plan");
assert.ok(hasPermissionOption("codex", "-c sandbox_mode=read-only"));
assert.ok(!hasPermissionOption("codex", "-c model=o3"), "권한 아닌 -c는 상관없음");
assert.ok(hasPermissionOption("codex", "-aon-request"), "붙여 쓴 짧은 옵션");
assert.strictEqual(launchLine("codex", { choice: "full-access", userArgs: "-c model=o3" }), "codex --dangerously-bypass-approvals-and-sandbox -c model=o3");
// 고를 수 있는 선택
assert.deepStrictEqual(choicesOf("claude"), ["own", "ask", "accept-edits", "auto", "full-access"]);
assert.deepStrictEqual(choicesOf("pi"), ["own"], "자체 설정만");
assert.deepStrictEqual(choicesOf("goose"), ["own", "full-access"]);
// lift — 인자 속 알려진 플래그 → 권한 선택
assert.deepStrictEqual(liftPermission("claude", "--dangerously-skip-permissions --model opus"), { choice: "full-access", rest: "--model opus" });
assert.deepStrictEqual(liftPermission("continue", '--allow "*"'), { choice: "full-access", rest: "" });
assert.deepStrictEqual(liftPermission("claude", "--permission-mode auto"), { choice: "auto", rest: "" });
assert.strictEqual(liftPermission("claude", "--model opus"), null);
assert.strictEqual(BY_ID.get("dsh").req[0], "dsh");
assert.deepStrictEqual(liftPermission("claude", "--permission-mode=acceptEdits --model x"), { choice: "accept-edits", rest: "--model x" }, "--opt=값도 옮김");
const ids = new Map(identityBins());
assert.ok(!ids.has("pi") && !ids.has("cn") && !ids.has("acli") && ids.get("goose") === "goose", "짧은 이름은 신원에서 뺌");
assert.ok(carriersOf("claude").includes("--permission-mode"));
assert.deepStrictEqual(liftPermission("claude", '--append-system-prompt="a  b" --dangerously-skip-permissions'), { choice: "full-access", rest: '--append-system-prompt="a  b"' }, "나머지는 원래 형태 그대로");
assert.ok(hasPermissionOption("claude", '"--dangerously-skip-permissions"'), "따옴표로 감싼 권한 플래그도 알아봄");
assert.deepStrictEqual(liftPermission("claude", '"--dangerously-skip-permissions" --model x'), { choice: "full-access", rest: "--model x" });
assert.deepStrictEqual(liftPermission("claude", "--append-system-prompt=don't --dangerously-skip-permissions"), { choice: "full-access", rest: "--append-system-prompt=don't" }, "짝 없는 따옴표 유지");
assert.deepStrictEqual(liftPermission("continue", '--allow "*"'), { choice: "full-access", rest: "" });
assert.strictEqual(liftPermission("claude", "--permission-mode bypassPermissions").choice, "full-access", "같은 뜻 다른 표기");
assert.strictEqual(liftPermission("claude", "--permission-mode=bypassPermissions").choice, "full-access");
assert.strictEqual(liftPermission("codex", "--yolo").choice, "full-access");
assert.strictEqual(liftPermission("gemini", "-y").choice, "full-access");
assert.strictEqual(liftPermission("claude", "\\--dangerously-skip-permissions").choice, "full-access", "\\ 이스케이프");
assert.deepStrictEqual(liftPermission("grok", "--permission-mode default --yolo"), { choice: "full-access", rest: "" }, "넓은 권한이 이김·전부 뺌");
assert.deepStrictEqual(liftPermission("claude", "--dangerously-skip-permissions --permission-mode bypassPermissions --model x"), { choice: "full-access", rest: "--model x" }, "같은 뜻 두 번도 다 뺌");
assert.deepStrictEqual(liftPermission("claude", "--permission-mode acceptEdits --permission-mode bypassPermissions"), { choice: "full-access", rest: "" });
assert.deepStrictEqual(liftPermission("gemini", "--yolo -y"), { choice: "full-access", rest: "" });
assert.deepStrictEqual(liftPermission("devin", "--permission-mode bypass --model x --respect-workspace-trust false"), { choice: "full-access", rest: "--model x" }, "떨어져 있어도");
assert.strictEqual(liftPermission("codex", "-s danger-full-access").choice, "full-access");
assert.strictEqual(liftPermission("codex", "--sandbox=danger-full-access").choice, "full-access");
assert.ok(weakDetect("pi") && weakDetect("continue") && weakDetect("rovo") && !weakDetect("claude") && !weakDetect("dsh"), "짧은 이름으로만 감지");
// 유저 환경변수(#1197) — 해석·따옴표·카탈로그 env와 겹침
assert.deepStrictEqual(parseEnv("# 주석\n\nexport A=1\nB = \"x y\"\n1BAD=no\n=nope\nC='q'\nD=a=b"), { A: "1", B: "x y", C: "q", D: "a=b" });
assert.strictEqual(launchLine("claude", { userEnv: "A=1\nB=$(rm -rf ~); echo" }), "A='1' B='$(rm -rf ~); echo' claude", "값은 작은따옴표 — 셸이 해석 안 함");
assert.strictEqual(launchLine("claude", { userEnv: "Q=it's" }), "Q='it'\\''s' claude", "작은따옴표 이스케이프");
assert.strictEqual(launchLine("goose", { choice: "full-access", userEnv: "GOOSE_MODE=chat\nX=1" }), "GOOSE_MODE=auto X='1' goose", "권한 env는 유저 환경변수로 못 바꿈");
assert.strictEqual(launchLine("goose", { userEnv: "GOOSE_MODE=auto" }), "goose", "권한 env로 확인창 우회 안 됨");
assert.deepStrictEqual(parseEnv("A=x\ry\nB=\u0003\nC=ok"), { C: "ok" }, "제어문자 줄은 건너뜀");
assert.strictEqual(launchLine("claude", { userEnv: "A=1", shell: "fish" }), "begin; set -lx A '1'; claude; end", "fish는 begin 블록 + set -lx");
assert.strictEqual(launchLine("claude", { userEnv: "A=C:\\x\nB=it's\nC=end\\", shell: "fish" }), "begin; set -lx A 'C:\\\\x'; set -lx B 'it\\'s'; set -lx C 'end\\\\'; claude; end", "fish 따옴표 안 \\·'");
assert.strictEqual(launchLine("goose", { choice: "full-access", shell: "fish" }), "begin; set -lx GOOSE_MODE 'auto'; goose; end");
assert.strictEqual(launchLine("claude", { userEnv: "PATH=/a:/b", shell: "fish" }), "begin; set -lx PATH '/a' '/b'; claude; end", "fish PATH는 목록으로");
assert.strictEqual(launchLine("claude", { userEnv: "API_PATH=https://x", shell: "fish" }), "begin; set -lx API_PATH 'https://x'; claude; end", "PATH로 끝나도 목록 변수가 아니면 그대로");
assert.strictEqual(launchLine("claude", { userEnv: "A=1", shell: "zsh" }), "A='1' claude");
assert.strictEqual(launchLine("goose", { choice: "full-access", userEnv: "X=1" }), "GOOSE_MODE=auto X='1' goose");
assert.strictEqual(Object.keys(parseEnv(Array.from({ length: 60 }, (_, i) => `K${i}=1`).join("\n"))).length, 50, "50개까지");
console.log("agent-catalog.test ok");
