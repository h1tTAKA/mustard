// Draft PR 열기 — 작업 폴더의 브랜치를 origin에 push하고 gh pr create --draft. Crew 머지 관문(#1110)·겨루기 채택(#1174)이 같이 씀. 서버 전용.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexecFile = promisify(execFile);

// 시작점 ref → gh --base에 넣을 브랜치 이름. 브랜치가 아닌 것(HEAD·커밋 SHA·PR 전용 ref)은 빈 값 = gh 기본(레포 기본 브랜치)
export function baseBranch(ref: string | undefined): string {
  const r = (ref ?? "").trim();
  if (!r || r === "HEAD" || /^[0-9a-f]{7,40}$/i.test(r)) return "";
  if (r.startsWith("refs/heads/")) return r.slice(11);
  if (r.startsWith("refs/remotes/")) return r.slice(13).split("/").slice(1).join("/");
  return r.startsWith("refs/") ? "" : r;
}

export async function openDraftPr(o: { dir: string; branch: string; base?: string; title: string; body: string }): Promise<{ url: string }> {
  const git = (args: string[]) => pexecFile("git", args, { cwd: o.dir, timeout: 120_000 }).then((r) => r.stdout.trim());
  const remote = await git(["remote"]).catch(() => "");
  if (!remote.split("\n").includes("origin")) throw new Error("no git remote 'origin'");
  await git(["push", "-u", "origin", o.branch]);
  const base = baseBranch(o.base);
  const out = await pexecFile("gh", ["pr", "create", "--draft", "--head", o.branch, ...(base ? ["--base", base] : []), "--title", o.title, "--body", o.body], { cwd: o.dir, timeout: 120_000 })
    .then((r) => r.stdout.trim()).catch((e) => { throw new Error(String((e as { stderr?: string }).stderr || (e as Error).message).trim().slice(0, 300) || "gh failed"); });
  return { url: out.split("\n").map((l) => l.trim()).find((l) => /^https?:\/\//.test(l)) ?? out };
}
