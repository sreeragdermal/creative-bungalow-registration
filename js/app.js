const config = window.CREATIVE_BUNGALOW_CONFIG || {};
const form = document.getElementById("registration-form");
const message = document.getElementById("form-message");
const setupBanner = document.getElementById("setup-banner");
const submitButton = document.getElementById("submit-button");
const fileInput = document.getElementById("payment-screenshot");
const fileLabel = document.getElementById("file-label");
const turnstileTokenInput = document.getElementById("turnstile-token");
let turnstileWidgetId = null;
let turnstileToken = "";

const configured = (value) => typeof value === "string" && value.length > 0 && !value.startsWith("PASTE_");
function icon(name) {
  const paths = {
    "arrow-up-right": "M4 12 12 4M5 4h7v7",
    check: "m3 8 3.2 3.2L13 4.5"
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", paths[name]);
  svg.append(path);
  return svg;
}
const hasProjectConfig = configured(config.supabaseUrl) && configured(config.supabasePublishableKey) && configured(config.turnstileSiteKey);
const registrationEnabled = config.registrationEnabled === true;
document.getElementById("upi-id").textContent = config.upiId || "UPI ID not configured";
setupBanner.hidden = hasProjectConfig && registrationEnabled;

if (submitButton) {
  submitButton.disabled = !registrationEnabled;
  submitButton.textContent = registrationEnabled
    ? "Submit registration"
    : "Registration not open yet";
}

function showMessage(text, isError = true) {
  message.textContent = text;
  message.className = "form-message" + (text ? (isError ? " error" : " success") : "");
}
function resetCaptcha() {
  turnstileToken = "";
  turnstileTokenInput.value = "";
}
function renderCaptcha() {
  if (!configured(config.turnstileSiteKey)) {
    document.getElementById("turnstile-note").textContent = "Anti-spam verification must be configured before registration opens.";
    return;
  }
  if (!window.turnstile || turnstileWidgetId !== null) return;
  turnstileWidgetId = window.turnstile.render("#turnstile-widget", {
    sitekey: config.turnstileSiteKey,
    action: "registration",
    callback(token) {
      turnstileToken = token;
      turnstileTokenInput.value = token;
      document.getElementById("turnstile-note").textContent = "Verification complete.";
    },
    "expired-callback"() {
      resetCaptcha();
      document.getElementById("turnstile-note").textContent = "Verification expired. Please verify again.";
    },
    "error-callback"() {
      resetCaptcha();
      document.getElementById("turnstile-note").textContent = "Verification could not load. Refresh and try again.";
    }
  });
  document.getElementById("turnstile-note").textContent = "Complete the anti-spam check before submitting.";
}
if (configured(config.turnstileSiteKey)) {
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.defer = true;
  script.onload = renderCaptcha;
  document.head.appendChild(script);
}
window.addEventListener("load", renderCaptcha);

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) { fileLabel.textContent = "Choose a screenshot"; return; }
  if (file.size > 5 * 1024 * 1024) {
    fileInput.value = "";
    fileLabel.textContent = "Choose a screenshot";
    showMessage("The screenshot must be 5 MB or smaller.");
    return;
  }
  if (!["image/jpeg", "image/png"].includes(file.type)) {
    fileInput.value = "";
    fileLabel.textContent = "Choose a screenshot";
    showMessage("Please upload a JPG or PNG image.");
    return;
  }
  fileLabel.textContent = file.name;
  showMessage("");
});
document.getElementById("copy-upi").addEventListener("click", async function () {
  try { await navigator.clipboard.writeText(config.upiId || "dummy@okicici"); this.replaceChildren("Copied ", icon("check")); }
  catch { showMessage("Copy is unavailable here. Please copy the UPI ID manually."); }
});
document.getElementById("copy-reference").addEventListener("click", async function () {
  try { await navigator.clipboard.writeText(document.getElementById("registration-code").textContent); this.replaceChildren("Copied ", icon("check")); }
  catch { showMessage("Please select and copy the registration reference manually."); }
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");
  if (!form.reportValidity()) return;
  if (!hasProjectConfig || !registrationEnabled) {
    showMessage("Registration is not open yet. The site owner must finish backend setup and testing before opening registrations.");
    return;
  }
  if (!turnstileToken) { showMessage("Please complete anti-spam verification first."); return; }
  const file = fileInput.files?.[0];
  if (!file) { showMessage("Please upload your payment screenshot."); return; }
  if (file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png"].includes(file.type)) {
    showMessage("Please upload a JPEG or PNG screenshot no larger than 5 MB."); return;
  }
  const data = new FormData(form);
  data.set("turnstile_token", turnstileToken);
  submitButton.disabled = true;
  submitButton.textContent = "Submitting…";
  try {
    const endpoint = config.supabaseUrl.replace(/\/$/, "") + "/functions/v1/" + config.submitFunctionName;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { apikey: config.supabasePublishableKey },
      body: data
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 409) throw new Error("All 100 places are currently reserved. Please contact the event team.");
      throw new Error(result.error || "We could not submit your registration. Please try again.");
    }
    document.getElementById("registration-code").textContent = result.registrationCode || result.registration_code || "—";
    form.hidden = true;
    document.getElementById("success-panel").hidden = false;
    setupBanner.hidden = true;
    document.getElementById("success-panel").scrollIntoView({behavior:"smooth",block:"start"});
  } catch (error) {
    showMessage(error?.message || "Something went wrong. Please try again.");
    resetCaptcha();
    if (window.turnstile && turnstileWidgetId !== null) window.turnstile.reset(turnstileWidgetId);
  } finally {
    submitButton.disabled = false;
    const arrow = document.createElement("b");
    arrow.append(icon("arrow-up-right"));
    submitButton.replaceChildren("Submit registration ", arrow);
  }
});
