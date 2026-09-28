import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createClinicAgent } from "../src/agent.js";
import { loadClinic } from "../src/config.js";
import { handleTurn, emptySession, matchFaq } from "../src/flow.js";
import { createServer } from "../src/http.js";
import { processDueReminders } from "../src/reminders.js";
import { openStore } from "../src/store.js";
import { zonedToUtc } from "../src/time.js";
import { toCloudPayload } from "../src/whatsapp.js";

const clinic = loadClinic("grin-glow");

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gg-"));
  return openStore(dir);
}

function choice(result, prefix) {
  const list = result.messages.find((message) => message.type === "list");
  assert.ok(list, `expected a list for ${prefix}`);
  const row = list.rows.find((item) => item.id.startsWith(prefix));
  assert.ok(row, `expected an option ${prefix}`);
  return { id: row.id, text: row.title };
}

function payloadsOf(result) {
  return result.messages.map((message) => toCloudPayload("15550001111", message));
}

test("wall time in Asia/Kolkata converts to the right UTC instant", () => {
  const instant = zonedToUtc("2026-09-29", "10:00", "Asia/Kolkata");
  assert.equal(instant.toISOString(), "2026-09-29T04:30:00.000Z");
});

test("one booking runs from hello through reminder", async () => {
  const store = tempStore();
  const sent = [];
  const agent = createClinicAgent({
    clinic,
    store,
    sender: async (to, messages) => {
      sent.push({ to, messages });
      return [];
    },
  });
  const phone = "15550001111";
  const now = zonedToUtc("2026-09-28", "09:00", "Asia/Kolkata");
  let step = 0;
  async function say(input) {
    step += 1;
    return agent.handleMessage({ from: phone, messageId: `m-${step}`, ...input }, now);
  }

  const menu = await say({ text: "hi" });
  assert.equal(menu.messages[0].type, "buttons");
  payloadsOf(menu);

  const branches = await say({ id: "menu:book", text: "Book appointment" });
  const branch = choice(branches, "branch:adyar");
  const services = await say(branch);
  const service = choice(services, "service:checkup");
  const dates = await say(service);
  const date = choice(dates, "date:2026-09-28");
  const times = await say(date);
  const time = choice(times, "time:16:00");
  const named = await say(time);
  assert.match(named.messages[0].text, /name/i);
  const review = await say({ text: "Aisha Rahman" });
  assert.match(review.messages[0].body, /Aisha Rahman/);
  assert.match(review.messages[0].body, /Adyar/);
  payloadsOf(review);

  const done = await say({ id: "confirm:yes", text: "Confirm booking" });
  assert.match(done.messages[0].text, /You're booked/);
  const booking = store.bookings.all()[0];
  assert.equal(booking.name, "Aisha Rahman");
  assert.equal(booking.branchId, "adyar");
  assert.equal(booking.serviceId, "checkup");
  assert.equal(booking.date, "2026-09-28");
  assert.equal(booking.time, "16:00");
  assert.equal(booking.status, "confirmed");

  const reminder = store.reminders.all()[0];
  assert.equal(reminder.sendAt, "2026-09-28T08:30:00.000Z");
  assert.equal(reminder.status, "pending");

  const early = await processDueReminders({ store, now, sender: async () => {} });
  assert.equal(early.length, 0);

  const delivered = [];
  const fired = await processDueReminders({
    store,
    now: new Date(reminder.sendAt),
    sender: async (_to, messages) => delivered.push(messages[0].text),
  });
  assert.equal(fired[0].status, "sent");
  assert.match(delivered[0], /Aisha Rahman/);
  assert.match(delivered[0], /Reply YES/);
  assert.equal(store.reminders.all()[0].status, "sent");

  const ack = await say({ text: "yes" });
  assert.match(ack.messages[0].text, /noted that you're coming/);
  assert.equal(sent.length > 0, true);
});

test("a taken slot is not offered to the next patient", async () => {
  const store = tempStore();
  const agent = createClinicAgent({ clinic, store, sender: async () => [] });
  const now = zonedToUtc("2026-09-28", "09:00", "Asia/Kolkata");

  async function book(phone, name) {
    let step = 0;
    const say = (input) => {
      step += 1;
      return agent.handleMessage({ from: phone, messageId: `${phone}-${step}`, ...input }, now);
    };
    await say({ text: "hi" });
    const branches = await say({ id: "menu:book" });
    const services = await say(choice(branches, "branch:adyar"));
    const dates = await say(choice(services, "service:checkup"));
    const times = await say(choice(dates, "date:"));
    await say(choice(times, "time:"));
    await say({ text: name });
    return say({ id: "confirm:yes" });
  }

  const first = await book("15550001111", "Aisha Rahman");
  assert.ok(first.booking);
  const second = await book("15550002222", "Rahul Menon");
  assert.equal(second.booking.time === first.booking.time, false);
  assert.equal(store.bookings.all().length, 2);
});

test("sunday is closed and common questions are answered from config", () => {
  const session = emptySession("15550001111");
  const sunday = zonedToUtc("2026-09-27", "12:00", "Asia/Kolkata");
  const opened = handleTurn({
    clinic,
    session,
    input: { text: "book" },
    bookings: [],
    now: sunday,
  });
  const dates = handleTurn({
    clinic,
    session: opened.session,
    input: { id: "branch:adyar", text: "Adyar" },
    bookings: [],
    now: sunday,
  });
  const service = handleTurn({
    clinic,
    session: dates.session,
    input: { id: "service:checkup", text: "Dental checkup" },
    bookings: [],
    now: sunday,
  });
  const rows = service.messages.find((message) => message.type === "list").rows;
  assert.equal(rows.some((row) => row.id === "date:2026-09-27"), false);
  assert.equal(rows[0].id, "date:2026-09-28");

  const faq = matchFaq(clinic, "what are your timings?");
  assert.equal(faq.id, "hours");
  const answer = handleTurn({
    clinic,
    session: emptySession("15550001111"),
    input: { text: "what are your timings?" },
    bookings: [],
    now: sunday,
  });
  assert.match(answer.messages[0].text, /Monday to Saturday/);

  const unknown = handleTurn({
    clinic,
    session: emptySession("15550001111"),
    input: { text: "do you make gold teeth for pets?" },
    bookings: [],
    now: sunday,
  });
  assert.match(unknown.messages[0].text, /don't have that answer/);
});

test("webhook verify and one posted booking", async () => {
  const store = tempStore();
  const outbound = [];
  const agent = createClinicAgent({
    clinic,
    store,
    sender: async (_to, messages) => {
      outbound.push(messages);
      return [];
    },
  });
  const server = createServer({
    agent,
    verifyToken: "test-verify",
    appSecret: "",
    phoneNumberId: "1136397159564982",
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const row = (prefix) => {
    const list = outbound.at(-1).find((message) => message.type === "list");
    assert.ok(list, `expected a list before choosing ${prefix}`);
    const found = list.rows.find((item) => item.id.startsWith(prefix));
    assert.ok(found, `missing ${prefix}`);
    return found;
  };
  try {
    const challenge = await fetch(
      `${base}/webhook?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=8841`,
    );
    assert.equal(await challenge.text(), "8841");

    const denied = await fetch(
      `${base}/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`,
    );
    assert.equal(denied.status, 403);

    await postWhatsApp(base, textMessage("w-1", "hi"));
    await postWhatsApp(base, choiceMessage("w-2", "menu:book", "Book appointment"));
    const branch = row("branch:adyar");
    await postWhatsApp(base, choiceMessage("w-3", branch.id, branch.title));
    const service = row("service:cleaning");
    await postWhatsApp(base, choiceMessage("w-4", service.id, service.title));
    const date = row("date:");
    await postWhatsApp(base, choiceMessage("w-5", date.id, date.title));
    const time = row("time:");
    await postWhatsApp(base, choiceMessage("w-6", time.id, time.title));
    await postWhatsApp(base, textMessage("w-7", "Meera Iyer"));
    await postWhatsApp(base, choiceMessage("w-8", "confirm:yes", "Confirm booking"));
    await postWhatsApp(base, choiceMessage("w-8", "confirm:yes", "Confirm booking"));

    const bookings = store.bookings.all();
    assert.equal(bookings.length, 1);
    assert.equal(bookings[0].name, "Meera Iyer");
    assert.equal(bookings[0].serviceId, "cleaning");
    assert.equal(bookings[0].branchId, "adyar");
    assert.equal(bookings[0].date, date.id.slice("date:".length));
    assert.equal(bookings[0].time, time.id.slice("time:".length));
    assert.equal(store.reminders.all()[0].bookingId, bookings[0].id);
    assert.equal(store.reminders.all()[0].status, "pending");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

function textMessage(id, body) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "1136397159564982" },
              messages: [{ from: "15550003333", id, timestamp: "1", type: "text", text: { body } }],
            },
          },
        ],
      },
    ],
  };
}

function choiceMessage(id, replyId, title) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "1136397159564982" },
              messages: [
                {
                  from: "15550003333",
                  id,
                  timestamp: "1",
                  type: "interactive",
                  interactive: { type: "list_reply", list_reply: { id: replyId, title } },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function postWhatsApp(base, body) {
  return fetch(`${base}/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
