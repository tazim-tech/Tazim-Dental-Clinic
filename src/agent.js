import { emptySession, handleTurn } from "./flow.js";
import { buildReminder } from "./reminders.js";

export function createClinicAgent({ clinic, store, sender }) {
  return {
    async handleMessage(incoming, now = new Date()) {
      if (incoming.messageId && store.seen.has(incoming.messageId)) {
        return { duplicate: true, messages: [] };
      }

      const session = store.sessions.get(incoming.from) || emptySession(incoming.from);
      const result = handleTurn({
        clinic,
        session,
        input: incoming,
        bookings: store.bookings.all(),
        now,
      });

      if (result.booking) {
        const slotGone = store.bookings.taken(
          result.booking.branchId,
          result.booking.date,
          result.booking.time,
        );
        if (slotGone) {
          result.booking = null;
          result.messages = [
            {
              type: "text",
              text: "That slot was just taken. Send BOOK to pick another time.",
            },
          ];
        } else {
          result.booking.sourceMessageId = incoming.messageId || null;
          store.bookings.add(result.booking);
          store.reminders.add(buildReminder(clinic, result.booking, now));
        }
      }

      store.sessions.save(result.session);
      if (incoming.messageId) store.seen.add(incoming.messageId);

      if (sender && result.messages.length) {
        try {
          result.delivered = await sender(incoming.from, result.messages);
        } catch (error) {
          result.sendError = error.message;
          if (!result.booking) throw error;
        }
      }
      return result;
    },
  };
}
