import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

const config = window.CREATIVE_BUNGALOW_CONFIG || {};
const setupKey = (v) => typeof v === "string" && v.length > 0 && !v.startsWith("PASTE_");
const loginCard = document.getElementById("login-card");
const dashboard = document.getElementById("dashboard");
const loginForm = document.getElementById("login-form");
const loginMessage = document.getElementById("login-message");
const loginButton = document.getElementById("login-button");
const notice = document.getElementById("admin-notice");
const tableBody = document.getElementById("registrations-body");
const filterInput = document.getElementById("filter-input");
const lastUpdated = document.getElementById("last-updated");
const preflightButton = document.getElementById("run-backend-preflight");
const preflightResult = document.getElementById("backend-preflight-result");
const preflightCaptchaNote = document.getElementById("backend-preflight-captcha-note");
let preflightWidgetId = null;
let preflightToken = "";

let client = null;
let allRegistrations = [];

function setLoginMessage(text) {
  loginMessage.textContent = text;
  loginMessage.className = "form-message";
}
function setNotice(text) {
  notice.hidden = !text;
  notice.textContent = text;
}
function ensureClient() {
  if (!setupKey(config.supabaseUrl) || !setupKey(config.supabasePublishableKey)) {
    setLoginMessage("Admin setup is incomplete. Configure the Supabase URL and publishable key in js/config.js.");
    return null;
  }
  if (!client) client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  return client;
}
async function callAdmin(action, extra = {}) {
  const supabase = ensureClient();
  if (!supabase) throw new Error("Supabase configuration is missing.");
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Your session expired. Please sign in again.");
  const response = await fetch(config.supabaseUrl.replace(/\/$/, "") + "/functions/v1/admin-registration-action", {
    method: "POST",
    headers: {
      "apikey": config.supabasePublishableKey,
      "Authorization": "Bearer " + session.access_token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ action, ...extra })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Admin request failed.");
  return result;
}
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}
function cell(row, child) {
  const td = document.createElement("td");
  if (child) td.append(child);
  row.append(td);
  return td;
}
function actionButton(label, status, registrationId) {
  const button = el("button", label, "admin-action");
  button.type = "button";
  button.addEventListener("click", async () => {
    const explanation = status === "verified"
      ? "Verify the payment and confirm this registration?"
      : "Reject this payment and release the reserved place?";
    if (!window.confirm(explanation)) return;
    button.disabled = true;
    try {
      await callAdmin("update-payment", { registrationId, paymentStatus: status });
      await loadRegistrations();
      setNotice(status === "verified" ? "Payment marked verified and registration confirmed." : "Payment rejected; the place has been released.");
    } catch (error) {
      setNotice(error?.message || "Could not update payment.");
      button.disabled = false;
    }
  });
  return button;
}
function renderRows() {
  const query = filterInput.value.trim().toLowerCase();
  const rows = allRegistrations.filter(r => [
    r.full_name, r.registration_code, r.email, r.mobile, r.place, r.designation
  ].some(v => String(v || "").toLowerCase().includes(query)));
  tableBody.replaceChildren();
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = el("td", allRegistrations.length ? "No matching registrations." : "No registrations received yet.", "admin-empty");
    td.colSpan = 6;
    tr.append(td);
    tableBody.append(tr);
    return;
  }
  for (const registration of rows) {
    const tr = document.createElement("tr");
    const participant = document.createElement("div");
    participant.append(el("strong", registration.full_name));
    participant.append(el("div", registration.email, "admin-status"));
    cell(tr, participant);
    cell(tr, el("strong", registration.registration_code));
    const details = document.createElement("div");
    details.append(el("div", registration.mobile));
    details.append(el("div", registration.place, "admin-status"));
    details.append(el("div", registration.designation + " · " + registration.work_mode, "admin-status"));
    details.append(el("div", "Experience: " + registration.experience, "admin-status"));
    details.append(el("div", "Previous season: " + (registration.attended_previous_season ? "Yes" : "No"), "admin-status"));
    cell(tr, details);
    const paymentCell = document.createElement("td");
    const paymentStatus = String(registration.payment_status || "pending");
    paymentCell.append(el("span", paymentStatus.toUpperCase(), "status-pill " + paymentStatus));
    paymentCell.append(el("div", "₹" + Number(registration.fee_amount || 3000).toLocaleString("en-IN"), "admin-status"));
    paymentCell.append(el("div", registration.registration_status || "submitted", "admin-status"));
    tr.append(paymentCell);
    const screenshotCell = document.createElement("td");
    if (registration.screenshotUrl) {
      const link = el("a", "View screenshot ↗", "signed-link");
      link.href = registration.screenshotUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      screenshotCell.append(link);
    } else {
      screenshotCell.append(el("span", "Unavailable", "admin-status"));
    }
    tr.append(screenshotCell);
    const review = document.createElement("td");
    if (paymentStatus === "pending") {
      review.append(actionButton("Verify", "verified", registration.id));
      review.append(actionButton("Reject", "rejected", registration.id));
    } else {
      review.append(el("span", paymentStatus === "verified" ? "Reviewed ✓" : "Rejected", "admin-status"));
    }
    tr.append(review);
    tableBody.append(tr);
  }
}
async function loadRegistrations() {
  tableBody.replaceChildren();
  const row = document.createElement("tr");
  const td = el("td", "Loading registrations…", "admin-empty");
  td.colSpan = 6; row.append(td); tableBody.append(row);
  setNotice("");
  try {
    const result = await callAdmin("list");
    allRegistrations = Array.isArray(result.registrations) ? result.registrations : [];
    renderRows();
    lastUpdated.textContent = allRegistrations.length + " registration(s) · Updated " + new Date().toLocaleTimeString();
  } catch (error) {
    allRegistrations = [];
    tableBody.replaceChildren();
    const tr = document.createElement("tr");
    const errorCell = el("td", error?.message || "Could not load registrations.", "admin-empty");
    errorCell.colSpan = 6; tr.append(errorCell); tableBody.append(tr);
    setNotice(error?.message || "Could not load registrations.");
  }
}
function renderPreflightCaptcha() {
  if (dashboard.hidden || !window.turnstile || preflightWidgetId !== null) return;
  if (!setupKey(config.turnstileSiteKey)) {
    preflightCaptchaNote.textContent = "Turnstile site key is missing from js/config.js.";
    return;
  }
  preflightWidgetId = window.turnstile.render("#backend-preflight-turnstile", {
    sitekey: config.turnstileSiteKey,
    action: "registration",
    callback(token) {
      preflightToken = token;
      preflightButton.disabled = false;
      preflightCaptchaNote.textContent = "Verification complete.";
    },
    "expired-callback"() {
      preflightToken = "";
      preflightButton.disabled = true;
      preflightCaptchaNote.textContent = "Verification expired. Please verify again.";
    },
    "error-callback"() {
      preflightToken = "";
      preflightButton.disabled = true;
      preflightCaptchaNote.textContent = "Verification could not load. Refresh and try again.";
    }
  });
}
function ensurePreflightCaptcha() {
  if (window.turnstile) return renderPreflightCaptcha();
  if (document.getElementById("preflight-turnstile-script")) return;
  const script = document.createElement("script");
  script.id = "preflight-turnstile-script";
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.defer = true;
  script.onload = renderPreflightCaptcha;
  document.head.appendChild(script);
}
function showDashboard() {
  loginCard.hidden = true;
  dashboard.hidden = false;
  loadRegistrations();
  ensurePreflightCaptcha();
}
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setLoginMessage("");
  const supabase = ensureClient();
  if (!supabase) return;
  const formData = new FormData(loginForm);
  loginButton.disabled = true;
  loginButton.textContent = "Signing in…";
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: String(formData.get("email") || "").trim(),
      password: String(formData.get("password") || "")
    });
    if (error) throw error;
    showDashboard();
  } catch (error) {
    setLoginMessage(error?.message || "Sign-in failed.");
  } finally {
    loginButton.disabled = false;
    loginButton.innerHTML = "Sign in securely <b>↗</b>";
  }
});
document.getElementById("signout-button").addEventListener("click", async () => {
  if (client) await client.auth.signOut();
  dashboard.hidden = true;
  loginCard.hidden = false;
  loginForm.reset();
  setNotice("");
});
document.getElementById("refresh-button").addEventListener("click", loadRegistrations);

const deleteTestButton = document.getElementById("delete-test-registrations");
const testToolsResult = document.getElementById("test-tools-result");
deleteTestButton.addEventListener("click", async () => {
  if (!window.confirm("Remove pending TEST ONLY dummy registrations and their dummy screenshots? Genuine participant records are not targeted.")) return;
  deleteTestButton.disabled = true;
  testToolsResult.className = "form-message";
  testToolsResult.textContent = "Removing dummy test entries…";
  try {
    const result = await callAdmin("delete-test-registrations");
    testToolsResult.className = "form-message success";
    testToolsResult.textContent = result.message;
    await loadRegistrations();
  } catch (error) {
    testToolsResult.className = "form-message error";
    testToolsResult.textContent = error?.message || "Could not remove dummy test entries.";
  } finally {
    deleteTestButton.disabled = false;
  }
});


const createTestButton = document.getElementById("create-test-registration");
const testToolsResult = document.getElementById("test-tools-result");
createTestButton.addEventListener("click", async () => {
  if (!window.confirm("Create one clearly labelled TEST ONLY registration with a dummy screenshot? No payment will be made. It temporarily uses one place until cleanup.")) return;
  createTestButton.disabled = true;
  testToolsResult.className = "form-message";
  testToolsResult.textContent = "Creating dummy test entry…";
  try {
    const result = await callAdmin("create-test-registration");
    testToolsResult.className = "form-message success";
    testToolsResult.textContent = result.message + " Reference: " + result.registrationCode;
    await loadRegistrations();
  } catch (error) {
    testToolsResult.className = "form-message error";
    testToolsResult.textContent = error?.message || "Could not create dummy test entry.";
  } finally {
    createTestButton.disabled = false;
  }
});

filterInput.addEventListener("input", renderRows);
preflightButton.addEventListener("click", async () => {
  if (!preflightToken) {
    preflightResult.textContent = "Complete anti-spam verification first.";
    return;
  }
  preflightButton.disabled = true;
  preflightResult.className = "form-message";
  preflightResult.textContent = "Running read-only checks…";
  try {
    const result = await callAdmin("backend-preflight", { turnstileToken: preflightToken });
    const labels = {
      adminSession: "Admin session",
      turnstileServerVerification: "Turnstile server verification",
      serverKeyConfigured: "Server key",
      privateScreenshotBucket: "Screenshot bucket is private",
      registrationRpc: "Registration database function"
    };
    const summary = Object.entries(result.checks || {}).map(([key, value]) =>
      (value === "passed" ? "✓ " : "✗ ") + (labels[key] || key) + ": " + value
    ).join(" | ");
    preflightResult.className = "form-message " + (result.ok ? "success" : "error");
    preflightResult.textContent = summary + ". " + (result.message || "");
  } catch (error) {
    preflightResult.className = "form-message error";
    preflightResult.textContent = error?.message || "Readiness check failed.";
  } finally {
    preflightToken = "";
    if (window.turnstile && preflightWidgetId !== null) window.turnstile.reset(preflightWidgetId);
    preflightCaptchaNote.textContent = "Verify again before another check.";
  }
});

(async () => {
  const supabase = ensureClient();
  if (!supabase) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (session) showDashboard();
})();