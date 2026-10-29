import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
function readKeyMap(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value as Record<string, string> : {};
  } catch { return {}; }
}
function secretKey(): string {
  const key = readKeyMap(Deno.env.get("SUPABASE_SECRET_KEYS")).default
    || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("Server secret is not configured.");
  return key;
}
function publishableKey(): string {
  const key = readKeyMap(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")).default
    || Deno.env.get("SUPABASE_ANON_KEY");
  if (!key) throw new Error("Publishable key is not configured.");
  return key;
}
function allowedOrigins(): string[] {
  return (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map(v => v.trim()).filter(Boolean);
}
function cors(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
function json(origin: string, value: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function encodedStoragePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  if (!origin || !allowedOrigins().includes(origin)) {
    return new Response(JSON.stringify({ error: "Origin is not allowed." }), {
      status: 403, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json(origin, { error: "Method not allowed." }, 405);

  const auth = req.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return json(origin, { error: "Please sign in as an administrator." }, 401);

  let adminKey: string;
  let publicKey: string;
  try { adminKey = secretKey(); publicKey = publishableKey(); }
  catch { return json(origin, { error: "Admin service is not configured." }, 503); }

  // Validate the access token with Supabase Auth; never trust a user ID supplied by the client.
  let userId = "";
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { "apikey": publicKey, "Authorization": `Bearer ${match[1]}` },
    });
    if (!response.ok) return json(origin, { error: "Your session has expired. Please sign in again." }, 401);
    const user = await response.json();
    if (typeof user.id === "string") userId = user.id;
  } catch {
    return json(origin, { error: "Could not validate the admin session." }, 502);
  }
  if (!userId) return json(origin, { error: "Invalid admin session." }, 401);

  // Only user IDs explicitly allowlisted in registration_admins can access participant records.
  const membershipUrl = new URL(`${SUPABASE_URL}/rest/v1/registration_admins`);
  membershipUrl.searchParams.set("select", "user_id");
  membershipUrl.searchParams.set("user_id", `eq.${userId}`);
  membershipUrl.searchParams.set("limit", "1");
  const membershipResponse = await fetch(membershipUrl, { headers: { "apikey": adminKey } });
  if (!membershipResponse.ok) return json(origin, { error: "Unable to verify admin access." }, 502);
  const membership = await membershipResponse.json();
  if (!Array.isArray(membership) || membership.length !== 1) {
    return json(origin, { error: "This account is not authorized as an administrator." }, 403);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json(origin, { error: "Invalid request body." }, 400); }

  if (body.action === "list") {
    const target = new URL(`${SUPABASE_URL}/rest/v1/registrations`);
    target.searchParams.set("select", "id,registration_code,full_name,mobile,place,email,designation,experience,work_mode,attended_previous_season,fee_amount,payment_screenshot_path,payment_status,registration_status,created_at");
    target.searchParams.set("order", "created_at.desc");
    target.searchParams.set("limit", "100");
    const response = await fetch(target, { headers: { "apikey": adminKey } });
    if (!response.ok) return json(origin, { error: "Could not load registrations." }, 502);
    const rows = await response.json();
    if (!Array.isArray(rows)) return json(origin, { error: "Unexpected registration response." }, 502);

    const registrations = await Promise.all(rows.map(async (row: Record<string, unknown>) => {
      let screenshotUrl: string | null = null;
      const path = typeof row.payment_screenshot_path === "string" ? row.payment_screenshot_path : "";
      if (path.startsWith("pending/")) {
        try {
          const signedResponse = await fetch(
            `${SUPABASE_URL}/storage/v1/object/sign/payment-screenshots/${encodedStoragePath(path)}`,
            {
              method: "POST",
              headers: { "apikey": adminKey, "Content-Type": "application/json" },
              body: JSON.stringify({ expiresIn: 300 }),
            },
          );
          if (signedResponse.ok) {
            const signedData = await signedResponse.json();
            const signed = signedData.signedURL || signedData.signedUrl;
            if (typeof signed === "string") {
              screenshotUrl = signed.startsWith("http") ? signed : `${SUPABASE_URL}/storage/v1${signed}`;
            }
          }
        } catch { /* The row remains visible if a preview URL is temporarily unavailable. */ }
      }
      return { ...row, screenshotUrl };
    }));
    return json(origin, { registrations });
  }

  if (body.action === "update-payment") {
    const id = typeof body.registrationId === "string" ? body.registrationId : "";
    const status = body.paymentStatus;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ||
        !["verified", "rejected"].includes(String(status))) {
      return json(origin, { error: "Invalid payment update." }, 400);
    }
    const registrationStatus = status === "verified" ? "confirmed" : "cancelled";
    const target = new URL(`${SUPABASE_URL}/rest/v1/registrations`);
    target.searchParams.set("id", `eq.${id}`);
    const response = await fetch(target, {
      method: "PATCH",
      headers: { "apikey": adminKey, "Content-Type": "application/json", "Prefer": "return=representation" },
      body: JSON.stringify({ payment_status: status, registration_status: registrationStatus }),
    });
    if (!response.ok) return json(origin, { error: "Payment status could not be updated." }, 502);
    const rows = await response.json().catch(() => []);
    if (!Array.isArray(rows) || rows.length !== 1) return json(origin, { error: "Registration was not found." }, 404);
    return json(origin, { ok: true, paymentStatus: status, registrationStatus });
  }

  return json(origin, { error: "Unknown admin action." }, 400);
});