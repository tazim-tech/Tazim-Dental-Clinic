import os from "node:os";
import path from "node:path";
import { loadEnv } from "../src/env.js";
import { loadClinic } from "../src/config.js";
import { openStore } from "../src/store.js";
import { createClinicAgent } from "../src/agent.js";
import { processDueReminders } from "../src/reminders.js";
import { zonedParts } from "../src/time.js";

loadEnv();
process.env.DATA_DIR = path.join(os.tmpdir(), `grin-glow-demo-${Date.now()}`);

const clinic = loadClinic("grin-glow");
const store = openStore();
const transcript = [];

async function sender(to, messages) {
  transcript.push({ to, messages });
  return messages.map((message) => ({ dryRun: true, payload: message }));
}

const agent = createClinicAgent({ clinic, store, sender });
const phone = "15550001111";
let n = 0;

function printBot(messages) {
  for (const message of messages) {
    console.log("");
    if (message.type === "text") console.log(message.text);
    if (message.type === "buttons" || message.type === "list") {
      console.log(message.body);
      const options = message.buttons || message.rows;
      options.forEach((option, index) => {
        const extra = option.description ? ` — ${option.description}` : "";
        console.log(`  ${index + 1}. ${option.title}${extra}`);
      });
    }
  }
}

async function patient(input, label) {
  n += 1;
  console.log(`\nPatient: ${label}`);
  const result = await agent.handleMessage(
    { from: phone, messageId: `demo-${n}`, text: input.text || "", id: input.id || "" },
    new Date(),
  );
  printBot(result.messages);
  return result;
}

function firstChoice(result, prefix) {
  const list = result.messages.find((message) => message.type === "list");
  if (!list) throw new Error(`Expected a list of ${prefix}`);
  const row = list.rows.find((item) => item.id.startsWith(prefix));
  if (!row) throw new Error(`No ${prefix} option was offered`);
  return row;
}

const menu = await patient({ text: "hi" }, "hi");
if (!menu.messages.some((message) => message.type === "buttons")) {
  throw new Error("Welcome menu did not render");
}

const branches = await patient({ id: "menu:book", text: "Book appointment" }, "Book appointment");
const branch = firstChoice(branches, "branch:");
const services = await patient({ id: branch.id, text: branch.title }, branch.title);
const service = firstChoice(services, "service:checkup");
const dates = await patient({ id: service.id, text: service.title }, service.title);
const date = firstChoice(dates, "date:");
const times = await patient({ id: date.id, text: date.title }, date.title);
const time = firstChoice(times, "time:");
await patient({ id: time.id, text: time.title }, time.title);
const done = await patient({ text: "Aisha Rahman" }, "Aisha Rahman");
await patient({ id: "confirm:yes", text: "Confirm booking" }, "Confirm booking");

const booking = store.bookings.all()[0];
if (!booking) {
  console.error("\nDemo failed: no booking was saved.");
  process.exit(1);
}

const reminder = store.reminders.all()[0];
const when = zonedParts(new Date(reminder.sendAt), clinic.timezone);
console.log("\n---");
console.log(`Booking ${booking.id} saved for ${booking.name}.`);
console.log(`${booking.serviceName} at ${booking.branchName}, ${booking.whenLabel}.`);
console.log(`Reminder scheduled for ${when.isoDate} ${when.hour}:${when.minute} IST.`);

const sent = [];
await processDueReminders({
  store,
  now: new Date(reminder.sendAt),
  sender: async (_to, messages) => {
    sent.push(messages[0].text);
  },
});
if (!sent.length || store.reminders.all()[0].status !== "sent") {
  console.error("Reminder did not send when its time arrived.");
  process.exit(1);
}
console.log("\nReminder text:");
console.log(sent[0]);
console.log("\nOne booking completed end to end (local). Live WhatsApp sends once the webhook is connected.");
