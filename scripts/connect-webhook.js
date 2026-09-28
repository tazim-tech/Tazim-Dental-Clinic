import { loadEnv } from "../src/env.js";

loadEnv();

const token = process.env.WHATSAPP_TOKEN || "";
const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const version = process.env.WHATSAPP_API_VERSION || "v25.0";
const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || "";
const arg = process.argv[2] || "";

if (!token || !phoneId || !verifyToken) {
  console.error("Set WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, and WHATSAPP_VERIFY_TOKEN in .env");
  process.exit(1);
}

const clear = arg === "--clear";
if (!clear && !arg.startsWith("https://")) {
  console.error("Usage: node scripts/connect-webhook.js https://<host>/webhook");
  console.error("       node scripts/connect-webhook.js --clear");
  process.exit(1);
}

const body = {
  webhook_configuration: clear
    ? { override_callback_uri: "" }
    : { override_callback_uri: arg, verify_token: verifyToken },
};

const response = await fetch(`https://graph.facebook.com/${version}/${phoneId}`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});
const data = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error(data.error?.message || `WhatsApp API ${response.status}`);
  if (data.error?.code) console.error(`code ${data.error.code}`);
  process.exit(1);
}

console.log(clear ? "Phone-number webhook override cleared." : `Webhook override set to ${arg}`);
