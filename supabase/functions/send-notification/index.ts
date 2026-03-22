/**
 * Supabase Edge Function: send-notification
 *
 * 솔라피 SMS + Resend 이메일 발송을 처리합니다.
 * POST body: { type: "sms"|"email", to, from?, message, subject? }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
  };
}

// ─── HMAC-SHA256 (Web Crypto API) ───────────────────────────
async function hmacSha256(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── 솔라피 SMS ─────────────────────────────────────────────
async function sendSolapi(
  to: string,
  from: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = Deno.env.get("SOLAPI_API_KEY") ?? "";
  const apiSecret = Deno.env.get("SOLAPI_API_SECRET") ?? "";

  if (!apiKey || !apiSecret) {
    return { ok: false, error: "솔라피 API Key/Secret이 설정되지 않았습니다." };
  }

  const date = new Date().toISOString();
  const salt = crypto.randomUUID();
  const signature = await hmacSha256(apiSecret, date + salt);

  const res = await fetch("https://api.solapi.com/messages/v4/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
    },
    body: JSON.stringify({
      message: {
        to: to.replace(/-/g, ""),
        from: from.replace(/-/g, ""),
        text: message,
      },
    }),
  });

  const text = await res.text();
  console.log("Solapi response:", res.status, text);

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: `파싱 실패: ${text.substring(0, 200)}` };
  }

  // 솔라피 성공: groupId가 있으면 성공
  if (data.groupId) {
    return { ok: true, groupId: data.groupId, messageId: data.messageId };
  }

  // 솔라피 에러: statusCode 또는 errorCode 필드가 있는 경우
  if (data.statusCode || data.errorCode || !res.ok) {
    return {
      ok: false,
      error: (data.errorMessage as string) || (data.message as string) || `HTTP ${res.status}`,
    };
  }

  return { ok: true };
}

// ─── Google SMTP via Apps Script (프록시) ────────────────────
// Supabase Edge Function에서 직접 SMTP를 사용할 수 없으므로
// Google Apps Script Web App을 프록시로 사용하여 이메일을 발송합니다.
async function sendEmail(
  to: string,
  subject: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  const emailProxyUrl = Deno.env.get("EMAIL_PROXY_URL") ?? "";

  if (!emailProxyUrl) {
    return { ok: false, error: "이메일 프록시 URL이 설정되지 않았습니다." };
  }

  try {
    const res = await fetch(emailProxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sendEmail", to, subject, body: message }),
    });

    const data = await res.json();
    if (data.success || data.ok) return { ok: true };
    return { ok: false, error: data.error || data.message || "이메일 발송 실패" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── 핸들러 ─────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req) });
  }

  try {
    const body = await req.json();
    const { type, to, from, message, subject } = body;

    if (!type || !to || !message) {
      return new Response(
        JSON.stringify({ ok: false, error: "type, to, message는 필수입니다." }),
        { status: 400, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } },
      );
    }

    let result: { ok: boolean; error?: string };

    if (type === "sms") {
      result = await sendSolapi(to, from || "", message);
    } else if (type === "email") {
      result = await sendEmail(to, subject || "[KDT 출결안내]", message);
    } else {
      result = { ok: false, error: `지원하지 않는 타입: ${type}` };
    }

    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : 400,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } },
    );
  }
});
