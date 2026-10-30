import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const BUCKET = "payment-screenshots";
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

function parseKeyDictionary(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value as Record<string, string> : {};
  } catch {
    return {};
  }
}

function getServerKey(): string {
  const modern = parseKeyDictionary(Deno.env.get("SUPABASE_SECRET_KEYS"));
  const key = modern.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("Server secret key is not configured.");
  return key;
}

function allowlist(): string[] {
  return (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function reply(origin: string, body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function clean(value: FormDataEntryValue | null, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

function validImageSignature(bytes: Uint8Array, mime: string): boolean {
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png") {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length >= png.length && png.every((n, i) => bytes[i] === n);
  }
  return false;
}

async function deleteUploadedFile(serverKey: string, path: string): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
      method: "DELETE",
      headers: { "apikey": serverKey, "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: [path] }),
    });
  } catch {
    // Do not expose storage cleanup details to the public caller.
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  const origins = allowlist();
  if (!origin || !origins.includes(origin)) {
    return new Response(JSON.stringify({ error: "Origin is not allowed." }), {
      status: 403, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return reply(origin, { error: "Method not allowed." }, 405);

  // Enforce the registration switch on the server as well as in the static frontend.
  // Missing or false keeps the public endpoint closed by default.
  if (Deno.env.get("REGISTRATION_ENABLED") !== "true") {
    return reply(origin, { error: "Registration is not open yet. Please check back later." }, 403);
  }

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > 6 * 1024 * 1024) return reply(origin, { error: "Request is too large." }, 413);

  const supabaseUrl = SUPABASE_URL;
  const turnstileSecret = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";
  const serverKey = (() => { try { return getServerKey(); } catch { return ""; } })();
  if (!supabaseUrl || !serverKey || !turnstileSecret) {
    return reply(origin, { error: "Registration is not configured yet. Please try again later." }, 503);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return reply(origin, { error: "The submitted form could not be read." }, 400);
  }

  // Honeypot: reject automated submissions without processing files.
  if (clean(form.get("website"), 200) !== "") {
    return reply(origin, { error: "Unable to process this submission." }, 400);
  }
  if (clean(form.get("consent"), 20) !== "on") {
    return reply(origin, { error: "Please confirm the registration declaration." }, 400);
  }

  const fullName = clean(form.get("full_name"), 100);
  const mobile = clean(form.get("mobile"), 20);
  const place = clean(form.get("place"), 100);
  const email = clean(form.get("email"), 254).toLowerCase();
  const designation = clean(form.get("designation"), 100);
  const experience = clean(form.get("experience"), 100);
  const workMode = clean(form.get("work_mode"), 20);
  const season = clean(form.get("attended_previous_season"), 5);
  const captchaToken = clean(form.get("turnstile_token"), 4096);
  const screenshot = form.get("payment_screenshot");

  if (fullName.length < 2 || mobile.length < 7 || !/^[+()\d\s-]{7,20}$/.test(mobile) ||
      place.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      designation.length < 1 || experience.length < 1 ||
      !["Freelance", "On-site"].includes(workMode) ||
      !["yes", "no"].includes(season)) {
    return reply(origin, { error: "Please check your details and try again." }, 400);
  }
  if (!captchaToken) return reply(origin, { error: "Please complete anti-spam verification." }, 400);
  if (!(screenshot instanceof File) || screenshot.size < 1 || screenshot.size > MAX_FILE_BYTES) {
    return reply(origin, { error: "Upload a JPEG or PNG screenshot no larger than 5 MB." }, 400);
  }
  if (!["image/jpeg", "image/png"].includes(screenshot.type)) {
    return reply(origin, { error: "Only JPEG and PNG screenshots are allowed." }, 400);
  }

  // Verify the anti-spam token server-side; browser-side validation alone is not trusted.
  try {
    const verifyBody = new URLSearchParams({ secret: turnstileSecret, response: captchaToken });
    const remoteIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (remoteIp) verifyBody.set("remoteip", remoteIp);
    const verifyResponse = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: verifyBody,
    });
    const verifyResult = await verifyResponse.json();
    const originHost = new URL(origin).hostname;
    if (!verifyResponse.ok || verifyResult.success !== true ||
        verifyResult.action !== "registration" ||
        verifyResult.hostname !== originHost) {
      return reply(origin, { error: "Anti-spam verification failed. Please verify again." }, 400);
    }
  } catch {
    return reply(origin, { error: "Anti-spam verification is temporarily unavailable." }, 502);
  }

  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await screenshot.arrayBuffer()); }
  catch { return reply(origin, { error: "The screenshot could not be read." }, 400); }
  if (!validImageSignature(bytes, screenshot.type)) {
    return reply(origin, { error: "The uploaded file is not a valid JPEG or PNG image." }, 400);
  }

  const extension = screenshot.type === "image/jpeg" ? "jpg" : "png";
  const path = `pending/${crypto.randomUUID()}.${extension}`;
  let uploaded = false;
  try {
    const uploadResponse = await fetch(
      `${supabaseUrl}/storage/v1/object/${BUCKET}/${path}`,
      {
        method: "POST",
        headers: {
          "apikey": serverKey,
          "Content-Type": screenshot.type,
          "x-upsert": "false",
          "cache-control": "3600",
        },
        body: bytes,
      },
    );
    if (!uploadResponse.ok) {
      return reply(origin, { error: "Screenshot upload failed. Please try again." }, 502);
    }
    uploaded = true;

    const rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/create_registration_with_capacity`, {
      method: "POST",
      headers: {
        "apikey": serverKey,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        p_full_name: fullName,
        p_mobile: mobile,
        p_place: place,
        p_email: email,
        p_designation: designation,
        p_experience: experience,
        p_work_mode: workMode,
        p_attended_previous_season: season === "yes",
        p_payment_screenshot_path: path,
        p_fee_amount: 2999,
      }),
    });
    const rpcResult = await rpcResponse.json().catch(() => null);
    if (!rpcResponse.ok) {
      await deleteUploadedFile(serverKey, path);
      if (JSON.stringify(rpcResult).includes("REGISTRATION_CAPACITY_REACHED")) {
        return reply(origin, { error: "All 100 places have been taken. Please contact the event team." }, 409);
      }
      return reply(origin, { error: "Registration could not be saved. Please try again." }, 500);
    }
    const record = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
    if (!record?.registration_code) {
      await deleteUploadedFile(serverKey, path);
      return reply(origin, { error: "Registration could not be confirmed. Please try again." }, 500);
    }
    return reply(origin, {
      registrationCode: record.registration_code,
      status: "pending",
      message: "Registration received. Payment verification is pending.",
    }, 201);
  } catch {
    if (uploaded) await deleteUploadedFile(serverKey, path);
    return reply(origin, { error: "A temporary server error occurred. Please try again." }, 500);
  }
});
