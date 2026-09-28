import { loadEnv } from "../src/env.js";

loadEnv();

const token = process.env.WHATSAPP_TOKEN || "";
const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const waba = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "";
const versions = ["v25.0", "v24.0", "v23.0", "v22.0", "v21.0", "v20.0"];

if (!token || !phoneId) {
  console.error("WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID must be set in .env");
  process.exit(1);
}

async function get(version, path) {
  const response = await fetch(`https://graph.facebook.com/${version}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

let worked = null;
let lastError = null;
for (const version of versions) {
  const result = await get(
    version,
    `${phoneId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`,
  );
  if (result.ok) {
    worked = version;
    console.log(`Graph API ${version} accepted the token.`);
    console.log(`Test number: ${result.data.display_phone_number || "unknown"}`);
    console.log(`Name: ${result.data.verified_name || "not verified yet"}`);
    if (result.data.quality_rating) console.log(`Quality: ${result.data.quality_rating}`);
    break;
  }
  lastError = result.data.error || { message: `HTTP ${result.status}` };
  console.log(`Graph API ${version}: ${lastError.message}`);
}

if (!worked) {
  console.error("The access token was rejected. In Meta, open WhatsApp > API Setup and generate a new token, then replace WHATSAPP_TOKEN in .env.");
  if (lastError?.code) console.error(`Last error code: ${lastError.code}`);
  process.exit(1);
}

if (waba) {
  const account = await get(worked, `${waba}?fields=id,name`);
  if (account.ok) {
    console.log(`WhatsApp Business account: ${account.data.name || account.data.id}`);
  } else {
    console.log(`Business account lookup: ${account.data.error?.message || account.status}`);
  }
}

if (process.env.WHATSAPP_API_VERSION !== worked) {
  console.log(`Set WHATSAPP_API_VERSION=${worked} in .env`);
}
