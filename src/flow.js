import {
  addIsoDays,
  formatTimeLabel,
  formatWhen,
  shortDate,
  slotIsBookable,
  weekdayOf,
  zonedParts,
  zonedToUtc,
} from "./time.js";

export function emptySession(phone) {
  return {
    phone,
    state: "welcome",
    draft: {},
    pendingOptions: [],
    updatedAt: null,
  };
}

export function matchFaq(clinic, text) {
  const query = text.toLowerCase();
  let best = null;
  let score = 0;
  for (const faq of clinic.faqs) {
    let next = 0;
    for (const keyword of faq.keywords || []) {
      if (query.includes(keyword.toLowerCase())) next += keyword.length;
    }
    if (next > score) {
      score = next;
      best = faq;
    }
  }
  return score >= 3 ? best : null;
}

function say(session, messages, extra = {}) {
  const options = [];
  for (const message of messages) {
    for (const button of message.buttons || []) {
      options.push({ id: button.id, label: button.title });
    }
    for (const row of message.rows || []) {
      options.push({ id: row.id, label: row.title });
    }
  }
  session.pendingOptions = options;
  session.updatedAt = new Date().toISOString();
  return { session, messages, ...extra };
}

function textMsg(text) {
  return { type: "text", text };
}

function buttons(body, items) {
  return { type: "buttons", body, buttons: items };
}

function list(body, button, rows, section) {
  return { type: "list", body, button, rows, section };
}

function resolveInput(session, input) {
  if (input.id) return input;
  const text = (input.text || "").trim();
  const options = session.pendingOptions || [];
  if (/^\d+$/.test(text)) {
    const option = options[Number(text) - 1];
    if (option) return { ...input, id: option.id, text: option.label };
  }
  const match = options.find((option) => option.label.toLowerCase() === text.toLowerCase());
  if (match) return { ...input, id: match.id, text: match.label };
  return input;
}

function branchById(clinic, id) {
  return clinic.branches.find((branch) => branch.id === id) || null;
}

function serviceById(clinic, id) {
  return clinic.services.find((service) => service.id === id) || null;
}

function openTimes(clinic, branch, isoDate, bookings, now) {
  if (clinic.closedDates.includes(isoDate)) return [];
  if (!branch.slots.days.includes(weekdayOf(isoDate))) return [];
  return branch.slots.times.filter(
    (time) =>
      slotIsBookable(isoDate, time, now, clinic) &&
      !bookings.some(
        (booking) =>
          booking.status === "confirmed" &&
          booking.branchId === branch.id &&
          booking.date === isoDate &&
          booking.time === time,
      ),
  );
}

function openDates(clinic, branch, bookings, now) {
  const today = zonedParts(now, clinic.timezone).isoDate;
  const dates = [];
  for (let offset = 0; offset < clinic.bookingWindowDays && dates.length < 10; offset += 1) {
    const iso = addIsoDays(today, offset);
    const times = openTimes(clinic, branch, iso, bookings, now);
    if (times.length) dates.push({ iso, times });
  }
  return dates;
}

function menuMessage(clinic, lead) {
  const intro =
    lead ||
    `${clinic.name}\n${clinic.tagline ? clinic.tagline + "\n\n" : "\n"}I can book a visit, answer a common question, or share the branches.`;
  return buttons(intro, [
    { id: "menu:book", title: "Book appointment" },
    { id: "menu:faq", title: "Ask a question" },
    { id: "menu:branches", title: "Our branches" },
  ]);
}

function showMenu(clinic, session, lead) {
  session.state = "welcome";
  session.draft = {};
  return say(session, [menuMessage(clinic, lead)]);
}

function showBranches(clinic, session) {
  session.state = "welcome";
  const lines = [`${clinic.name} branches`, ""];
  for (const branch of clinic.branches) {
    lines.push(`${branch.name}`);
    lines.push(branch.address);
    lines.push("");
  }
  lines.push("Parking depends on the street. Ask the desk when you confirm.");
  return say(session, [
    textMsg(lines.join("\n").trim()),
    buttons("What next?", [
      { id: "menu:book", title: "Book appointment" },
      { id: "menu:home", title: "Main menu" },
    ]),
  ]);
}

function showFaqs(clinic, session) {
  session.state = "faq";
  const rows = clinic.faqs.slice(0, 10).map((faq) => ({
    id: `faq:${faq.id}`,
    title: faq.menuTitle || faq.q || faq.id,
  }));
  return say(session, [
    list("Tap a question, or type your own.", "See questions", rows, "Questions"),
  ]);
}

function answerFaq(clinic, session, faq) {
  session.state = "faq";
  return say(session, [
    textMsg(faq.a),
    buttons("Want to book a visit?", [
      { id: "menu:book", title: "Book appointment" },
      { id: "menu:faq", title: "Ask another" },
    ]),
  ]);
}

function enquiryFallback(clinic, session) {
  session.state = "faq";
  return say(session, [
    textMsg(
      "I don't have that answer saved. The dentist can go through it at a visit, or the branch desk can help. You can book from here.",
    ),
    buttons("What next?", [
      { id: "menu:book", title: "Book appointment" },
      { id: "menu:faq", title: "Ask another" },
    ]),
  ]);
}

function startBooking(clinic, session, bookings, now) {
  session.draft = {};
  if (clinic.branches.length === 1) {
    session.draft.branchId = clinic.branches[0].id;
    return askService(clinic, session);
  }
  session.state = "pick_branch";
  return say(session, [
    list(
      "Which branch suits you?",
      "Choose branch",
      clinic.branches.map((branch) => ({
        id: `branch:${branch.id}`,
        title: branch.name,
        description: branch.address,
      })),
      "Branches",
    ),
  ]);
}

function askService(clinic, session) {
  session.state = "pick_service";
  const branch = branchById(clinic, session.draft.branchId);
  return say(session, [
    list(
      `${branch.name} — what is the visit for?`,
      "Choose visit",
      clinic.services.map((service) => ({
        id: `service:${service.id}`,
        title: service.name,
        description: service.minutes ? `${service.minutes} min` : "",
      })),
      "Visits",
    ),
  ]);
}

function askDate(clinic, session, bookings, now) {
  const branch = branchById(clinic, session.draft.branchId);
  const dates = openDates(clinic, branch, bookings, now);
  if (!dates.length) {
    session.state = "welcome";
    session.draft = {};
    return say(session, [
      textMsg(`${branch.name} has no open slots in the next ${clinic.bookingWindowDays} days.`),
      menuMessage(clinic, "You can try another branch, or ask a question."),
    ]);
  }
  session.state = "pick_date";
  return say(session, [
    list(
      "Which day works?",
      "Choose day",
      dates.map((date) => ({
        id: `date:${date.iso}`,
        title: shortDate(date.iso, clinic.timezone),
        description: `${date.times.length} open`,
      })),
      "Days",
    ),
  ]);
}

function askTime(clinic, session, bookings, now) {
  const branch = branchById(clinic, session.draft.branchId);
  const times = openTimes(clinic, branch, session.draft.date, bookings, now);
  if (!times.length) {
    return askDate(clinic, session, bookings, now);
  }
  session.state = "pick_time";
  return say(session, [
    list(
      `${shortDate(session.draft.date, clinic.timezone)} — which time?`,
      "Choose time",
      times.map((time) => ({
        id: `time:${time}`,
        title: formatTimeLabel(time),
      })),
      "Times",
    ),
  ]);
}

function askName(session) {
  session.state = "ask_name";
  return say(session, [textMsg("What name should we put on the appointment?")]);
}

function summary(clinic, session) {
  const branch = branchById(clinic, session.draft.branchId);
  const service = serviceById(clinic, session.draft.serviceId);
  const when = formatWhen(session.draft.date, session.draft.time, clinic.timezone);
  return [
    "Please confirm this visit:",
    "",
    `Name: ${session.draft.name}`,
    `Branch: ${branch.name}`,
    `Visit: ${service.name}`,
    `When: ${when}`,
    "",
    "This WhatsApp number is the contact number.",
  ].join("\n");
}

function bookingFromDraft(clinic, session, now) {
  const branch = branchById(clinic, session.draft.branchId);
  const service = serviceById(clinic, session.draft.serviceId);
  const dateStamp = zonedParts(now, clinic.timezone).isoDate.replace(/-/g, "");
  const suffix = Math.random().toString(16).slice(2, 6).toUpperCase();
  return {
    id: `${clinic.bookingPrefix}-${dateStamp}-${suffix}`,
    clinicId: clinic.id,
    phone: session.phone,
    name: session.draft.name,
    branchId: branch.id,
    branchName: branch.name,
    serviceId: service.id,
    serviceName: service.name,
    date: session.draft.date,
    time: session.draft.time,
    whenLabel: formatWhen(session.draft.date, session.draft.time, clinic.timezone),
    status: "confirmed",
    createdAt: now.toISOString(),
  };
}

function confirmation(clinic, booking) {
  return [
    `You're booked at ${clinic.name}.`,
    "",
    `Ref: ${booking.id}`,
    `Name: ${booking.name}`,
    `Branch: ${booking.branchName}`,
    `Visit: ${booking.serviceName}`,
    `When: ${booking.whenLabel}`,
    "",
    "Please arrive 10 minutes early. A reminder will come on this chat before the visit.",
    "To change it, book a new slot and tell the branch the old ref.",
  ].join("\n");
}

function onBranch(clinic, session, id) {
  const branchId = id.startsWith("branch:") ? id.slice("branch:".length) : "";
  const branch =
    branchById(clinic, branchId) ||
    clinic.branches.find((item) => item.name.toLowerCase() === (session._text || "").toLowerCase());
  if (!branch) return startBooking(clinic, session, [], new Date());
  session.draft.branchId = branch.id;
  return askService(clinic, session);
}

function onService(clinic, session, bookings, now, id) {
  const serviceId = id.startsWith("service:") ? id.slice("service:".length) : "";
  const service = serviceById(clinic, serviceId);
  if (!service) return askService(clinic, session);
  session.draft.serviceId = service.id;
  return askDate(clinic, session, bookings, now);
}

function onDate(clinic, session, bookings, now, id) {
  const iso = id.startsWith("date:") ? id.slice("date:".length) : "";
  const branch = branchById(clinic, session.draft.branchId);
  const allowed = openDates(clinic, branch, bookings, now).some((date) => date.iso === iso);
  if (!allowed) return askDate(clinic, session, bookings, now);
  session.draft.date = iso;
  return askTime(clinic, session, bookings, now);
}

function onTime(clinic, session, bookings, now, id) {
  const time = id.startsWith("time:") ? id.slice("time:".length) : "";
  const branch = branchById(clinic, session.draft.branchId);
  const allowed = openTimes(clinic, branch, session.draft.date, bookings, now).includes(time);
  if (!allowed) return askTime(clinic, session, bookings, now);
  session.draft.time = time;
  return askName(session);
}

function onName(clinic, session, text) {
  const name = text.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 60 || /^\d+$/.test(name)) {
    return say(session, [textMsg("Please send the patient's name, the way it should appear on the visit.")]);
  }
  session.draft.name = name;
  session.state = "confirm";
  return say(session, [
    buttons(summary(clinic, session), [
      { id: "confirm:yes", title: "Confirm booking" },
      { id: "confirm:no", title: "Start over" },
    ]),
  ]);
}

function onConfirm(clinic, session, bookings, now, id) {
  if (id !== "confirm:yes") return showMenu(clinic, session, "No booking was made.");
  const branch = branchById(clinic, session.draft.branchId);
  const stillOpen = openTimes(clinic, branch, session.draft.date, bookings, now).includes(session.draft.time);
  if (!stillOpen) {
    return say(session, [
      textMsg("That slot was just taken. Please pick another time."),
      ...askTime(clinic, session, bookings, now).messages,
    ]);
  }
  const booking = bookingFromDraft(clinic, session, now);
  session.state = "welcome";
  session.draft = {};
  return say(
    session,
    [
      textMsg(confirmation(clinic, booking)),
      buttons("Anything else?", [
        { id: "menu:book", title: "Book another" },
        { id: "menu:faq", title: "Ask a question" },
      ]),
    ],
    { booking },
  );
}

function isGreeting(text) {
  return /^(hi|hello|hey|hii|menu|start|help)$/.test(text);
}

function isCancel(text) {
  return /^(cancel|stop|quit)$/.test(text);
}

export function handleTurn({ clinic, session, input, bookings, now = new Date() }) {
  const resolved = resolveInput(session, input);
  const text = (resolved.text || "").trim();
  const id = resolved.id || "";
  const norm = text.toLowerCase().replace(/\s+/g, " ");
  session._text = text;

  if (resolved.unsupported) {
    return say(session, [textMsg("Please send a text message, or tap one of the options.")]);
  }

  if (isCancel(norm) && session.state !== "ask_name") {
    return showMenu(clinic, session, "That draft is cleared.");
  }

  if (isGreeting(norm) || id === "menu:home") {
    return showMenu(clinic, session);
  }

  if (id === "menu:book" || (session.state === "welcome" && /\b(book|appointment|slot)\b/.test(norm))) {
    return startBooking(clinic, session, bookings, now);
  }
  if (id === "menu:faq" || (session.state === "welcome" && /\b(faq|question)\b/.test(norm))) {
    return showFaqs(clinic, session);
  }
  if (
    id === "menu:branches" ||
    (session.state === "welcome" && /\b(branch|branches|address|location|where)\b/.test(norm))
  ) {
    return showBranches(clinic, session);
  }

  if (session.state === "welcome" && /^(yes|coming)$/.test(norm)) {
    const upcoming = bookings.find((booking) => {
      if (booking.phone !== session.phone || booking.status !== "confirmed") return false;
      return zonedToUtc(booking.date, booking.time, clinic.timezone).getTime() > now.getTime();
    });
    if (upcoming) {
      return say(session, [
        textMsg(`Thanks ${upcoming.name}. We've noted that you're coming on ${upcoming.whenLabel}. Ref ${upcoming.id}.`),
      ]);
    }
  }

  switch (session.state) {
    case "pick_branch":
      return onBranch(clinic, session, id);
    case "pick_service":
      return onService(clinic, session, bookings, now, id);
    case "pick_date":
      return onDate(clinic, session, bookings, now, id);
    case "pick_time":
      return onTime(clinic, session, bookings, now, id);
    case "ask_name":
      return onName(clinic, session, text);
    case "confirm":
      return onConfirm(clinic, session, bookings, now, id);
    case "faq": {
      if (id.startsWith("faq:")) {
        const faq = clinic.faqs.find((item) => item.id === id.slice(4));
        if (faq) return answerFaq(clinic, session, faq);
      }
      const typed = matchFaq(clinic, text);
      if (typed) return answerFaq(clinic, session, typed);
      if (text.includes("?") || text.length > 20) return enquiryFallback(clinic, session);
      return showFaqs(clinic, session);
    }
    default: {
      const faq = text.length >= 4 ? matchFaq(clinic, text) : null;
      if (faq) return answerFaq(clinic, session, faq);
      if (text.includes("?") || text.length > 20) return enquiryFallback(clinic, session);
      return showMenu(clinic, session);
    }
  }
}
