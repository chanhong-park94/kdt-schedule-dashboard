/**
 * Supabase Edge Function: hrd-proxy
 *
 * HRD-Net API 프록시.
 * - authKey는 Deno.env('HRD_AUTH_KEY')에만 존재 (클라이언트/번들에 절대 노출 X)
 * - CORS 화이트리스트로 GitHub Pages/로컬 개발만 허용
 * - 두 가지 엔드포인트 지원: roster | daily
 *
 * 클라이언트 호출 예:
 *   POST /functions/v1/hrd-proxy
 *   body: { type: "roster", trainPrId: "AIG...", degr: "1" }
 *   body: { type: "daily",  trainPrId: "AIG...", degr: "1", month: "202604" }
 *
 * 응답: HRD-Net의 원본 JSON을 그대로 전달 (기존 parseResponse 로직은 클라이언트에서 유지)
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const HRD_BASE = "https://hrd.work24.go.kr/jsp/HRDP/HRDPO00/HRDPOA60/HRDPOA60_4.jsp";
const TIMEOUT_MS = 20_000;

const ALLOWED_ORIGINS = [
  "https://chanhong-park94.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
];

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

// ─── 입력 검증 ───────────────────────────────────────────────

type HrdType = "roster" | "daily";

interface HrdProxyRequest {
  type: HrdType;
  trainPrId: string;
  degr: string;
  month?: string; // YYYYMM, type="daily"일 때만
}

function isValidTrainPrId(s: unknown): s is string {
  return typeof s === "string" && /^[A-Z]{3}\d{14}$/.test(s);
}
function isValidDegr(s: unknown): s is string {
  return typeof s === "string" && /^\d{1,3}$/.test(s);
}
function isValidMonth(s: unknown): s is string {
  return typeof s === "string" && /^\d{6}$/.test(s);
}

function validateBody(body: unknown): HrdProxyRequest | { error: string } {
  if (!body || typeof body !== "object") return { error: "body가 비어 있습니다." };
  const b = body as Record<string, unknown>;

  if (b.type !== "roster" && b.type !== "daily") {
    return { error: 'type은 "roster" 또는 "daily"여야 합니다.' };
  }
  if (!isValidTrainPrId(b.trainPrId)) {
    return { error: "trainPrId 형식 오류 (예: AIG20240000498389)" };
  }
  if (!isValidDegr(b.degr)) {
    return { error: "degr 형식 오류 (숫자 1~3자리)" };
  }
  if (b.type === "daily" && !isValidMonth(b.month)) {
    return { error: "month 형식 오류 (YYYYMM 6자리)" };
  }

  return {
    type: b.type,
    trainPrId: b.trainPrId,
    degr: b.degr,
    month: b.type === "daily" ? (b.month as string) : undefined,
  };
}

// ─── HRD-Net 호출 ────────────────────────────────────────────

async function callHrd(req: HrdProxyRequest, authKey: string): Promise<unknown> {
  const params = new URLSearchParams({
    returnType: "JSON",
    authKey,
    srchTrprId: req.trainPrId,
    srchTrprDegr: req.degr,
    outType: "2",
  });

  if (req.type === "daily") {
    params.set("srchTorgId", "student_detail");
    params.set("atendMo", req.month!);
  }

  const url = `${HRD_BASE}?${params}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`HRD-Net HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

// ─── 핸들러 ──────────────────────────────────────────────────

serve(async (req: Request) => {
  const cors = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST only" }), {
      status: 405,
      headers: cors,
    });
  }

  const authKey = Deno.env.get("HRD_AUTH_KEY") ?? "";
  if (!authKey) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "서버에 HRD_AUTH_KEY가 설정되지 않았습니다.",
      }),
      { status: 500, headers: cors },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "JSON 파싱 실패" }), {
      status: 400,
      headers: cors,
    });
  }

  const validated = validateBody(body);
  if ("error" in validated) {
    return new Response(JSON.stringify({ ok: false, error: validated.error }), {
      status: 400,
      headers: cors,
    });
  }

  try {
    const data = await callHrd(validated, authKey);
    return new Response(JSON.stringify({ ok: true, data }), {
      status: 200,
      headers: cors,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 502,
      headers: cors,
    });
  }
});
