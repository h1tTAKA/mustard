// Crew 보드 저장소(#1098, 에픽 #1097) — 레포별 칸반 카드. 서버 전용.
// 저장 = ~/.nunopi/crew/<sha256(root)>/board.json (레포 안은 안 건드림). 쓰기는 tmp+rename(쓰다 죽어도 원본 유지).
// 연산(추가·수정·이동·삭제)은 서버에서 하고 결과 보드를 돌려줌 — 창이 여러 개여도 서버 파일이 기준.
// 동기 함수만(await 없음) → 한 서버 프로세스 안에서 요청끼리 끼어들 수 없음(catchupStore와 같은 이유).
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import { CREW_STATUSES, type CrewBoard, type CrewGate, type CrewOp, type CrewStatus, type CrewTask } from "./crewTypes.ts";
export type { CrewBoard, CrewOp, CrewStatus, CrewTask };

const TITLE_MAX = 200, BODY_MAX = 20_000, TASKS_MAX = 2000;
const normPath = (p: string) => p.replace(/\/+$/, "");
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
const baseDir = () => process.env.MUSTARD_CREW_DIR || join(homedir(), ".nunopi", "crew"); // 점검에서 임시 폴더로
export const boardFile = (root: string) => join(baseDir(), sha(normPath(root)), "board.json");
const isStatus = (s: unknown): s is CrewStatus => typeof s === "string" && (CREW_STATUSES as readonly string[]).includes(s);

// 역할 id — 기본 8 + 에픽 2번 커스텀 대비 slug 형식만 허용(빈 값 = 자동 배정)
const cleanRole = (r: unknown): string | undefined => (typeof r === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(r) ? r : undefined);

// #1102 오케스트레이터 필드 검증
function flowFields(t: Record<string, unknown>): Partial<CrewTask> {
  const out: Partial<CrewTask> = {};
  if (Array.isArray(t.pipeline)) { const p = t.pipeline.map(cleanRole).filter((r): r is string => !!r).slice(0, 30); if (p.length) out.pipeline = p; }
  const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1000 ? v : undefined);
  if (int(t.stage) !== undefined) out.stage = int(t.stage);
  if (int(t.loops) !== undefined) out.loops = int(t.loops);
  if (int(t.fails) !== undefined) out.fails = int(t.fails);
  const gt = t.gate as Record<string, unknown> | undefined;
  if (gt && typeof gt === "object" && ["spec", "schema", "merge", "question", "blocked"].includes(String(gt.kind)) && int(gt.stage) !== undefined)
    out.gate = { kind: gt.kind as CrewGate["kind"], stage: int(gt.stage)!, ...(typeof gt.text === "string" ? { text: gt.text.slice(0, 4000) } : {}) };
  if (typeof t.note === "string" && t.note) out.note = t.note.slice(0, 8000);
  if (int(t.consults) !== undefined) out.consults = int(t.consults);
  if (int(t.reviews) !== undefined) out.reviews = int(t.reviews);
  const pr = t.pr as Record<string, unknown> | undefined;
  if (pr && typeof pr.url === "string" && /^https?:\/\//.test(pr.url)) out.pr = { url: pr.url.slice(0, 500) };
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^[\w-]{1,64}$/.test(x)).slice(0, 20) : []);
  if (Array.isArray(t.split)) {
    const sp = t.split.flatMap((x, i) => {
      const s = x as Record<string, unknown>;
      if (!s || typeof s.title !== "string" || !s.title.trim()) return [];
      const after = Array.isArray(s.after) ? s.after.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < i) : [];
      return [{ title: s.title.trim().slice(0, 200), ...(typeof s.body === "string" && s.body ? { body: s.body.slice(0, 8000) } : {}),
        roles: Array.isArray(s.roles) ? s.roles.map(cleanRole).filter((r): r is string => !!r).slice(0, 20) : [], ...(after.length ? { after } : {}) }];
    }).slice(0, 8);
    if (sp.length) out.split = sp;
  }
  if (ids(t.children).length) out.children = ids(t.children);
  if (ids(t.dependsOn).length) out.dependsOn = ids(t.dependsOn);
  if (ids([t.parentId]).length) out.parentId = t.parentId as string;
  const c = t.consult as Record<string, unknown> | undefined;
  if (c && typeof c === "object" && int(c.stage) !== undefined && cleanRole(c.from) && typeof c.question === "string")
    out.consult = { stage: int(c.stage)!, from: cleanRole(c.from)!, question: c.question.slice(0, 4000) };
  return out;
}

export function sanitizeTask(x: unknown): CrewTask | null {
  if (!x || typeof x !== "object") return null;
  const t = x as Record<string, unknown>;
  if (typeof t.id !== "string" || !t.id || typeof t.title !== "string" || !t.title.trim() || !isStatus(t.status)) return null;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    id: t.id.slice(0, 64), title: t.title.trim().slice(0, TITLE_MAX), body: typeof t.body === "string" ? t.body.slice(0, BODY_MAX) : "",
    status: t.status, order: num(t.order, 0), createdAt: num(t.createdAt, 0), updatedAt: num(t.updatedAt, 0),
    ...(cleanRole(t.role) ? { role: cleanRole(t.role) } : {}),
    ...flowFields(t),
  };
}

// repair=false — 읽기만(깨진 파일을 옆으로 치우지 않음, 캐치업 세션 찾기처럼 보드와 무관한 경로용 #1135)
export function readBoard(root: string, repair = true): CrewBoard {
  const file = boardFile(root);
  if (!existsSync(file)) return { version: 1, tasks: [] };
  try {
    const j = JSON.parse(readFileSync(file, "utf8")) as { tasks?: unknown; auto?: unknown };
    const tasks = Array.isArray(j.tasks) ? j.tasks.map(sanitizeTask).filter((t): t is CrewTask => !!t) : [];
    return { version: 1, tasks, ...(j.auto === true ? { auto: true } : {}) };
  } catch {
    if (repair) try { renameSync(file, `${file}.broken-${Date.now()}`); } catch { /* 백업 실패해도 빈 보드로 */ } // 깨진 파일은 남겨 두고(복구용) 빈 보드
    return { version: 1, tasks: [] };
  }
}

function writeBoard(root: string, board: CrewBoard): CrewBoard {
  const file = boardFile(root);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(board, null, 1));
  renameSync(`${file}.tmp`, file);
  return board;
}

// 칸 안 순서 다시 매기기(0,1,2…) — 이동·삭제 뒤 구멍 없게.
function renumber(tasks: CrewTask[], status: CrewStatus): void {
  tasks.filter((t) => t.status === status).sort((a, b) => a.order - b.order).forEach((t, i) => { t.order = i; });
}

// 연산 하나 적용 → 새 보드. 잘못된 입력이면 Error(라우트가 400).
export function applyOp(root: string, op: CrewOp, now = Date.now()): CrewBoard {
  const board = readBoard(root);
  const tasks = board.tasks;
  const find = (id: string) => { const t = tasks.find((x) => x.id === id); if (!t) throw new Error("task not found"); return t; };
  if (op.op === "create") {
    const title = String(op.title ?? "").trim();
    if (!title) throw new Error("title required");
    if (tasks.length >= TASKS_MAX) throw new Error("too many tasks");
    const status = isStatus(op.status) ? op.status : "backlog";
    const order = tasks.filter((t) => t.status === status).length; // 칸 맨 아래
    const role = cleanRole(op.role);
    const pipeline = (Array.isArray(op.pipeline) ? op.pipeline : []).map(cleanRole).filter((r): r is string => !!r).slice(0, 30);
    tasks.push({ id: randomUUID(), title: title.slice(0, TITLE_MAX), body: String(op.body ?? "").slice(0, BODY_MAX), status, order, createdAt: now, updatedAt: now, ...(role ? { role } : {}), ...(pipeline.length ? { pipeline, stage: 0 } : {}) });
  } else if (op.op === "update") {
    const t = find(op.id);
    if (op.title !== undefined) { const title = String(op.title).trim(); if (!title) throw new Error("title required"); t.title = title.slice(0, TITLE_MAX); }
    if (op.body !== undefined) t.body = String(op.body).slice(0, BODY_MAX);
    if (op.role !== undefined) { const role = cleanRole(op.role); if (role) t.role = role; else delete t.role; } // "" = 자동 배정으로
    if (op.pipeline !== undefined) { // #1102 사람이 정한 파이프라인(바뀌면 처음 단계부터)
      const p = (Array.isArray(op.pipeline) ? op.pipeline : []).map(cleanRole).filter((r): r is string => !!r).slice(0, 30);
      if (JSON.stringify(p) !== JSON.stringify(t.pipeline ?? [])) { if (p.length) t.pipeline = p; else delete t.pipeline; t.stage = 0; delete t.loops; delete t.fails; }
    }
    t.updatedAt = now;
  } else if (op.op === "move") {
    if (!isStatus(op.status)) throw new Error("bad status");
    const t = find(op.id);
    const from = t.status;
    // 목적 칸에서 자기 빼고 정렬 → index 자리에 끼우고 번호 다시
    const dest = tasks.filter((x) => x.status === op.status && x.id !== t.id).sort((a, b) => a.order - b.order);
    const at = Math.max(0, Math.min(Number.isFinite(op.index) ? Math.floor(op.index) : dest.length, dest.length));
    dest.splice(at, 0, t);
    t.status = op.status; t.updatedAt = now;
    dest.forEach((x, i) => { x.order = i; });
    if (from !== op.status) renumber(tasks, from);
  } else if (op.op === "delete") {
    const t = find(op.id);
    board.tasks = tasks.filter((x) => x.id !== t.id);
    renumber(board.tasks, t.status);
  } else if (op.op === "auto") { // #1137 레포의 '전부 알아서' 켜고 끄기
    if (op.on === true) board.auto = true; else delete board.auto;
  } else {
    throw new Error("unknown op");
  }
  return writeBoard(root, board);
}

// #1102 서버 전용 — 오케스트레이터가 카드의 흐름 필드·칸을 바꿈(라우트로는 노출 안 함). undefined 값 = 그 필드 지움.
export type FlowPatch = Partial<Pick<CrewTask, "pipeline" | "stage" | "loops" | "fails" | "gate" | "note" | "consult" | "consults" | "reviews" | "pr" | "split" | "children" | "parentId" | "dependsOn">> & { status?: CrewStatus };
export function patchTask(root: string, id: string, patch: FlowPatch, now = Date.now()): CrewBoard {
  const board = readBoard(root);
  const i = board.tasks.findIndex((x) => x.id === id);
  if (i < 0) throw new Error("task not found");
  const { status, ...fields } = patch;
  const raw: Record<string, unknown> = { ...board.tasks[i] };
  for (const [k, v] of Object.entries(fields)) { if (v === undefined) delete raw[k]; else raw[k] = v; }
  const t = sanitizeTask(raw); // 잘못된 값은 걸러서 저장
  if (!t) throw new Error("bad patch");
  t.updatedAt = now;
  board.tasks[i] = t;
  writeBoard(root, board);
  return status && status !== t.status ? applyOp(root, { op: "move", id, status, index: board.tasks.filter((x) => x.status === status).length }, now) : board;
}
