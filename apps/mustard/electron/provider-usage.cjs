// Claude·Codex 구독 사용 한도(세션/주간/Fable) 조회(#735).
// 로컬 크레덴셜(accessToken)을 읽어 각 provider의 usage 엔드포인트를 호출한다.
// per-request 토큰이 아니라 "한도 윈도우 %·리셋 시간". main에서만(파일 접근·CORS 회피). 토큰은 읽기만.
const { readFile } = require("node:fs/promises");
const { homedir } = require("node:os");
const { join } = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { net } = require("electron");
const execFileAsync = promisify(execFile);

const CLAUDE_OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const TIMEOUT_MS = 10_000;

// resets_at 단위 판별: >1e10이면 이미 ms epoch, 아니면 초 epoch(×1000).
function parseResetTs(v) {
  if (typeof v === "number") return Number.isFinite(v) ? (v > 1e10 ? v : v * 1000) : null;
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n) && String(v).trim() !== "") return n > 1e10 ? n : n * 1000;
  const p = new Date(v).getTime();
  return Number.isNaN(p) ? null : p;
}

function resetLabel(ts) {
  if (ts == null) return null;
  try {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return d.toLocaleDateString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
  } catch {
    return null;
  }
}

// 다양한 필드명(utilization/used_percentage/used_percent, resets_at/reset_at) 수용.
function mapWindow(raw, windowMinutes) {
  if (!raw || typeof raw !== "object") return null;
  const pct =
    typeof raw.utilization === "number" ? raw.utilization
    : typeof raw.used_percentage === "number" ? raw.used_percentage
    : typeof raw.used_percent === "number" ? raw.used_percent
    : null;
  if (pct == null) return null;
  const resetsAt = parseResetTs(raw.resets_at ?? raw.reset_at);
  return { usedPercent: Math.min(100, Math.max(0, pct)), windowMinutes, resetsAt, resetLabel: resetLabel(resetsAt) };
}

// Electron net.fetch — main에서 OS 프록시/인증서 스택 사용(Node 전역 fetch보다 견고). app ready 후 호출됨.
async function fetchJson(url, headers) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await net.fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) return { error: `http-${res.status}` };
    return { data: await res.json() };
  } catch {
    return { error: "network" };
  } finally {
    clearTimeout(timer);
  }
}

function extractClaudeAccessToken(raw) {
  try {
    const j = JSON.parse(raw);
    const tok = j?.claudeAiOauth?.accessToken;
    return typeof tok === "string" && tok.trim() ? tok : null;
  } catch {
    return null;
  }
}

// macOS는 Claude Code 크레덴셜을 키체인(service "Claude Code-credentials")에 저장 — 파일이 없을 때 폴백.
async function readClaudeTokenFromKeychain() {
  if (process.platform !== "darwin") return null;
  try {
    const user = process.env.USER || process.env.USERNAME || "user";
    const { stdout } = await execFileAsync("security", ["find-generic-password", "-s", "Claude Code-credentials", "-a", user, "-w"], { timeout: 5000 });
    return extractClaudeAccessToken(stdout.trim());
  } catch {
    return null;
  }
}

async function readClaudeToken() {
  try {
    const raw = await readFile(join(homedir(), ".claude", ".credentials.json"), "utf8");
    const fromFile = extractClaudeAccessToken(raw);
    if (fromFile) return fromFile;
  } catch { /* 파일 없음 → 키체인 시도 */ }
  return readClaudeTokenFromKeychain();
}

// 401/403 = 인증 만료·무효 → "로그인 필요"(unavailable), 그 외 = error.
function statusForError(error) {
  return error === "http-401" || error === "http-403" ? "unavailable" : "error";
}

// Fable은 top-level 필드가 아니라 limits[] 배열의 weekly_scoped 항목(scope.model.display_name="Fable").
// 비활성(is_active=false)이어도 percent/resets_at를 가지므로 그대로 노출.
function fableFromLimits(data) {
  const limits = Array.isArray(data.limits) ? data.limits : [];
  const f = limits.find(
    (l) => l && l.kind === "weekly_scoped" && String(l.scope?.model?.display_name ?? "").trim().toLowerCase() === "fable",
  );
  if (!f || typeof f.percent !== "number") return null;
  return mapWindow({ used_percentage: f.percent, resets_at: f.resets_at }, 10080);
}

async function fetchClaudeUsage() {
  const token = await readClaudeToken();
  if (!token) return { provider: "claude", status: "unavailable" };
  const { data, error } = await fetchJson(CLAUDE_OAUTH_USAGE_URL, {
    Authorization: `Bearer ${token}`,
    "anthropic-beta": "oauth-2025-04-20",
    "User-Agent": "claude-code/2.1.0",
  });
  if (error) return { provider: "claude", status: statusForError(error) };
  if (!data) return { provider: "claude", status: "error" };
  // Fable 주간: limits[] 스코프 항목 우선, 없으면 옛 top-level 필드명 폴백.
  const fableWeekly = fableFromLimits(data) ?? mapWindow(data.fable_weekly, 10080) ?? mapWindow(data.fable_seven_day, 10080) ?? mapWindow(data.seven_day_fable, 10080) ?? null;
  return {
    provider: "claude",
    status: "ok",
    session: mapWindow(data.five_hour, 300),
    weekly: mapWindow(data.seven_day, 10080),
    fableWeekly,
  };
}

async function readCodexAuth() {
  try {
    const home = process.env.CODEX_HOME || join(homedir(), ".codex");
    const raw = await readFile(join(home, "auth.json"), "utf8");
    const j = JSON.parse(raw);
    const token = j?.tokens?.access_token;
    const accountId = j?.tokens?.account_id;
    return typeof token === "string" && token.trim() ? { token, accountId: typeof accountId === "string" ? accountId : null } : null;
  } catch {
    return null;
  }
}

async function fetchCodexUsage() {
  const auth = await readCodexAuth();
  if (!auth) return { provider: "codex", status: "unavailable" };
  // Codex 백엔드가 요구하는 헤더 — 없으면 인증돼도 거부될 수 있음.
  const headers = {
    Authorization: `Bearer ${auth.token}`,
    "User-Agent": "codex-cli",
    "OpenAI-Beta": "codex-1",
    originator: "Codex Desktop",
  };
  if (auth.accountId) headers["ChatGPT-Account-Id"] = auth.accountId;
  const { data, error } = await fetchJson(CODEX_USAGE_URL, headers);
  if (error) return { provider: "codex", status: statusForError(error) };
  if (!data) return { provider: "codex", status: "error" };
  const rl = data.rate_limit ?? data.rateLimits ?? {};
  // Codex 창은 plan마다 다름(team=주간만, 그 외=세션+주간). primary/secondary 위치가 아니라
  // limit_window_seconds(창 길이)로 세션(≤6h)/주간을 분류. 없는 창은 null(UI서 숨김).
  let session = null;
  let weekly = null;
  for (const raw of [rl.primary_window, rl.secondary_window]) {
    if (!raw || typeof raw.used_percent !== "number") continue;
    const secs = typeof raw.limit_window_seconds === "number" && raw.limit_window_seconds > 0 ? raw.limit_window_seconds : null;
    const windowMinutes = secs ? Math.round(secs / 60) : 10080;
    const w = mapWindow(raw, windowMinutes);
    if (!w) continue;
    if (windowMinutes <= 360) session = w; else weekly = w;
  }
  return { provider: "codex", status: "ok", session, weekly };
}

// ── Grok(#874). ~/.grok/auth.json 읽어 xAI billing 조회. 토큰 읽기만(로그인/refresh 안 함).
const GROK_BILLING_BASE = (process.env.GROK_CLI_CHAT_PROXY_BASE_URL?.trim().replace(/\/$/, "")) || "https://cli-chat-proxy.grok.com/v1";
const GROK_CREDITS_URL = `${GROK_BILLING_BASE}/billing?format=credits`;
const GROK_DEFAULT_URL = `${GROK_BILLING_BASE}/billing`;
const GROK_ISSUER = "https://auth.x.ai"; // 우선 issuer(auth.json 키 = "<issuer>::<clientId>")
const GROK_SKEW_MS = 5 * 60 * 1000;      // 만료 5분 전이면 stale 취급(요청 도중 만료 방지)
const WEEKLY_MIN = 10080;
const MONTHLY_MIN = 43200;

// auth.json: { "<issuer>::<clientId>": { key(=accessToken), user_id, expires_at, ... } }. 우선 issuer 엔트리 선택.
async function readGrokSession() {
  try {
    const home = process.env.GROK_HOME || join(homedir(), ".grok");
    const parsed = JSON.parse(await readFile(join(home, "auth.json"), "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    let preferred = null;
    let fallback = null;
    for (const [key, e] of Object.entries(parsed)) {
      if (!e || typeof e !== "object" || typeof e.key !== "string" || !e.key) continue;
      const s = { accessToken: e.key, userId: typeof e.user_id === "string" ? e.user_id : null, expiresAtMs: e.expires_at ? Date.parse(e.expires_at) : NaN };
      if (key === GROK_ISSUER || key.startsWith(`${GROK_ISSUER}::`)) { if (!preferred) preferred = s; }
      else if (!fallback) fallback = s;
    }
    return preferred || fallback; // 기본 issuer 우선, 없으면 대체 issuer
  } catch { return null; } // 파일 없음·손상 = 로그인 안 함
}

// 돈 필드 { val: "1.23" | 1.23 } → 숫자.
function grokMoney(v) {
  const raw = v?.val;
  const n = typeof raw === "string" ? Number.parseFloat(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

// 주간 크레딧% 우선, 없으면 월간 예산쌍(used/limit)으로 %. 한도(분모)가 없으면 null.
// percent는 명시적 유한수일 때만 신뢰 — 필드 누락을 0%로 렌더하지 않게.
// (무료 계정은 billing에 진짜 한도·사용량이 안 잡힘 — top-level used는 history와 모순돼 신뢰 불가라 안 씀.)
function mapGrokWindows(cfg) {
  const periodEnd = cfg.currentPeriod?.end ?? cfg.billingPeriodEnd ?? null;
  const resetsAt = periodEnd ? parseResetTs(periodEnd) : null;
  const win = (pct, minutes) => ({ usedPercent: Math.min(100, Math.max(0, pct)), windowMinutes: minutes, resetsAt, resetLabel: resetLabel(resetsAt) });
  const pct = cfg.creditUsagePercent;
  if (typeof pct === "number" && Number.isFinite(pct)) return { weekly: win(pct, WEEKLY_MIN) };
  const limit = grokMoney(cfg.monthlyLimit);
  const used = grokMoney(cfg.used);
  if (limit !== null && used !== null && limit > 0) return { monthly: win((used / limit) * 100, MONTHLY_MIN) };
  return null;
}

async function fetchGrokUsage() {
  const session = await readGrokSession();
  if (!session) return { provider: "grok", status: "unavailable" };
  // stale 토큰: API 못 침 → "grok 한번 돌려 갱신"(재로그인 아님 — CLI가 refresh_token으로 자동 갱신). expires_at 없으면 그냥 시도.
  if (Number.isFinite(session.expiresAtMs) && session.expiresAtMs - Date.now() < GROK_SKEW_MS) {
    return { provider: "grok", status: "error", needsRefresh: true };
  }
  const headers = { Authorization: `Bearer ${session.accessToken}`, "X-XAI-Token-Auth": "xai-grok-cli", Accept: "application/json" };
  if (session.userId) headers["x-userid"] = session.userId;
  const { data, error } = await fetchJson(GROK_CREDITS_URL, headers);
  // 세션이 있는데 401/403 = 토큰이 거부됨(만료·무효) → "grok 한번 돌려 갱신"(로그인 안 됨과 구분). 그 외는 일반 에러.
  if (error) {
    const authRejected = error === "http-401" || error === "http-403";
    return { provider: "grok", status: "error", ...(authRejected ? { needsRefresh: true } : {}) };
  }
  if (!data) return { provider: "grok", status: "error" };
  const cfg = (data.config && typeof data.config === "object") ? data.config : data;
  const w = mapGrokWindows(cfg);
  if (w) return { provider: "grok", status: "ok", weekly: w.weekly ?? null, monthly: w.monthly ?? null };
  // credits 뷰에 %가 없는 통합빌링 계정 → 기본 billing 뷰서 월간 예산 재시도.
  const fb = await fetchJson(GROK_DEFAULT_URL, headers);
  const fcfg = (fb.data?.config && typeof fb.data.config === "object") ? fb.data.config : (fb.data || {});
  const w2 = mapGrokWindows(fcfg);
  if (w2) return { provider: "grok", status: "ok", weekly: w2.weekly ?? null, monthly: w2.monthly ?? null };
  return { provider: "grok", status: "unavailable", signedIn: true }; // 로그인은 됐지만 노출할 한도 없음(무료 계정)
}

// 셋 병렬. 개별 실패는 status로 격리(전체 실패로 안 번지게).
async function getProviderUsage() {
  const [claude, codex, grok] = await Promise.all([
    fetchClaudeUsage().catch(() => ({ provider: "claude", status: "error" })),
    fetchCodexUsage().catch(() => ({ provider: "codex", status: "error" })),
    fetchGrokUsage().catch(() => ({ provider: "grok", status: "error" })),
  ]);
  return { claude, codex, grok };
}

module.exports = { getProviderUsage };
