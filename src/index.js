import { loadEnv } from "./env.js";
import { loadClinic } from "./config.js";
import { openStore } from "./store.js";
import { createClinicAgent } from "./agent.js";
import { createServer } from "./http.js";
import { deliver, markRead } from "./whatsapp.js";
import { processDueReminders } from "./reminders.js";

loadEnv();

const clinic = loadClinic(process.env.CLINIC_ID || "grin-glow");
const store = openStore();
const dryRun = process.env.WHATSAPP_DRY_RUN === "1";
const version = process.env.WHATSAPP_API_VERSION || "v25.0";
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const token = process.env.WHATSAPP_TOKEN || "";

function apiOptions() {
  return { dryRun, token, version, phoneNumberId };
}

async function sender(to, messages) {
  const sent = await deliver(to, messages, apiOptions());
  for (const item of sent) {
    store.outbox.add({
      to,
      dryRun: Boolean(item.dryRun),
      fellBack: Boolean(item.fellBack),
      type: item.payload?.type,
      error: item.error || null,
    });
  }
  return sent;
}

const agent = createClinicAgent({ clinic, store, sender });

async function onMessages(messages) {
  for (const message of messages) {
    const tail = String(message.from || "").slice(-4);
    console.log(`in …${tail} ${message.type}${message.id ? ` ${message.id}` : ""}`);
    try {
      const result = await agent.handleMessage(message);
      if (result.booking) console.log(`booked ${result.booking.id} …${tail}`);
      await markRead(message.messageId, apiOptions());
    } catch (error) {
      console.error(`message …${tail} failed: ${error.message}`);
      try {
        await sender(message.from, [
          { type: "text", text: "Sorry — please send that again in a moment." },
        ]);
      } catch (sendError) {
        console.error(`apology failed: ${sendError.message}`);
      }
    }
  }
}

const server = createServer({
  agent,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "",
  appSecret: process.env.WHATSAPP_APP_SECRET || "",
  phoneNumberId,
  onMessages,
});

const port = Number(process.env.PORT || 8787);
server.listen(port, () => {
  const tokenState = token ? "set" : "missing";
  console.log(`${clinic.name} agent on http://localhost:${port}`);
  console.log(`webhook http://localhost:${port}/webhook`);
  console.log(`phone number id ${phoneNumberId || "missing"} · token ${tokenState} · dry-run ${dryRun ? "on" : "off"}`);
});

const pollMs = Number(process.env.REMINDER_POLL_MS || 30000);
setInterval(() => {
  processDueReminders({ store, sender }).catch((error) => {
    console.error(`reminder poll failed: ${error.message}`);
  });
}, pollMs).unref();
