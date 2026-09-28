import { zonedToUtc } from "./time.js";

export function buildReminder(clinic, booking, now = new Date()) {
  const appointment = zonedToUtc(booking.date, booking.time, clinic.timezone);
  const leadMs = clinic.reminderLeadMinutes * 60 * 1000;
  const sendAt = new Date(Math.max(appointment.getTime() - leadMs, now.getTime()));
  return {
    id: `R-${booking.id}`,
    bookingId: booking.id,
    phone: booking.phone,
    sendAt: sendAt.toISOString(),
    body: [
      `Reminder from ${clinic.name}`,
      "",
      `${booking.name}, your ${booking.serviceName} at ${booking.branchName} is on ${booking.whenLabel}.`,
      `Ref: ${booking.id}`,
      "",
      "Reply YES if you're coming, or BOOK if you need a different slot.",
    ].join("\n"),
    status: "pending",
    attempts: 0,
  };
}

export function dueReminders(reminders, now = new Date()) {
  return reminders.filter(
    (reminder) => reminder.status === "pending" && new Date(reminder.sendAt).getTime() <= now.getTime(),
  );
}

export async function processDueReminders({ store, sender, now = new Date() }) {
  const due = dueReminders(store.reminders.all(), now);
  const results = [];
  for (const reminder of due) {
    try {
      await sender(reminder.phone, [{ type: "text", text: reminder.body }]);
      store.reminders.update(reminder.id, {
        status: "sent",
        sentAt: now.toISOString(),
        attempts: reminder.attempts + 1,
      });
      results.push({ id: reminder.id, status: "sent" });
    } catch (error) {
      const attempts = reminder.attempts + 1;
      store.reminders.update(reminder.id, {
        status: attempts >= 3 ? "failed" : "pending",
        attempts,
        lastError: error.message,
      });
      results.push({ id: reminder.id, status: "error", error: error.message });
    }
  }
  return results;
}
