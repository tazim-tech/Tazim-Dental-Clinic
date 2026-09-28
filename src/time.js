const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const map = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    isoDate: `${map.year}-${map.month}-${map.day}`,
    hour: map.hour,
    minute: map.minute,
    weekday: map.weekday.slice(0, 3).toLowerCase(),
  };
}

export function addIsoDays(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

export function weekdayOf(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

export function zonedToUtc(isoDate, time, timeZone) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wanted = Date.UTC(year, month - 1, day, hour, minute, 0);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  let guess = wanted;
  for (let i = 0; i < 4; i += 1) {
    const map = {};
    for (const part of fmt.formatToParts(new Date(guess))) {
      if (part.type !== "literal") map[part.type] = part.value;
    }
    const asUtc = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour, +map.minute);
    const diff = asUtc - wanted;
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
}

export function formatWhen(isoDate, time, timeZone) {
  const instant = zonedToUtc(isoDate, time, timeZone);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(instant);
}

export function shortDate(isoDate, timeZone) {
  const instant = zonedToUtc(isoDate, "12:00", timeZone);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(instant);
}

export function formatTimeLabel(hhmm) {
  const [hour, minute] = hhmm.split(":").map(Number);
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function slotIsBookable(isoDate, time, now, clinic) {
  const when = zonedToUtc(isoDate, time, clinic.timezone);
  return when.getTime() >= now.getTime() + clinic.minLeadMinutes * 60 * 1000;
}
