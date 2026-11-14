// 모든 /api/* 앞에서 출처 검사(#1340) — 규칙은 packages/core/src/apiGuard.ts(단독 nunopi 앱과 공용).
import { NextResponse, type NextRequest } from "next/server";
import { guardApi } from "@mustard/core/apiGuard";

export function proxy(request: NextRequest) {
  const g = guardApi({ host: request.headers.get("host"), secFetchSite: request.headers.get("sec-fetch-site"), origin: request.headers.get("origin") });
  if (!g.ok) return NextResponse.json({ ok: false, error: g.reason === "host" ? "host not allowed" : "cross-origin" }, { status: 403 });
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
