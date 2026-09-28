import fs from "node:fs";
import path from "node:path";
import { root } from "./env.js";

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

export function openStore(dir = process.env.DATA_DIR || path.join(root, "data")) {
  fs.mkdirSync(dir, { recursive: true });
  const files = {
    sessions: path.join(dir, "sessions.json"),
    bookings: path.join(dir, "bookings.json"),
    reminders: path.join(dir, "reminders.json"),
    seen: path.join(dir, "seen.json"),
    outbox: path.join(dir, "outbox.json"),
  };

  return {
    dir,
    sessions: {
      get(phone) {
        const all = readJson(files.sessions, {});
        return all[phone] || null;
      },
      save(session) {
        const all = readJson(files.sessions, {});
        all[session.phone] = session;
        writeJson(files.sessions, all);
      },
    },
    bookings: {
      all() {
        return readJson(files.bookings, []);
      },
      add(booking) {
        const all = readJson(files.bookings, []);
        all.push(booking);
        writeJson(files.bookings, all);
        return booking;
      },
      taken(branchId, date, time) {
        return readJson(files.bookings, []).some(
          (b) =>
            b.status === "confirmed" &&
            b.branchId === branchId &&
            b.date === date &&
            b.time === time,
        );
      },
    },
    reminders: {
      all() {
        return readJson(files.reminders, []);
      },
      add(reminder) {
        const all = readJson(files.reminders, []);
        all.push(reminder);
        writeJson(files.reminders, all);
        return reminder;
      },
      update(id, patch) {
        const all = readJson(files.reminders, []);
        const next = all.map((r) => (r.id === id ? { ...r, ...patch } : r));
        writeJson(files.reminders, next);
      },
    },
    seen: {
      has(id) {
        return readJson(files.seen, []).includes(id);
      },
      add(id) {
        const all = readJson(files.seen, []);
        all.push(id);
        writeJson(files.seen, all.slice(-2000));
      },
    },
    outbox: {
      all() {
        return readJson(files.outbox, []);
      },
      add(entry) {
        const all = readJson(files.outbox, []);
        all.push({ at: new Date().toISOString(), ...entry });
        writeJson(files.outbox, all.slice(-200));
      },
    },
  };
}
