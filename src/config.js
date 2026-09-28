import fs from "node:fs";
import path from "node:path";
import { root } from "./env.js";

const REQUIRED = ["id", "name", "timezone", "services", "faqs", "branches"];

export function loadClinic(clinicId = process.env.CLINIC_ID || "grin-glow") {
  const file = path.join(root, "config", "clinics", `${clinicId}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Clinic config not found: config/clinics/${clinicId}.json`);
  }
  const clinic = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const key of REQUIRED) {
    if (clinic[key] == null || clinic[key] === "") {
      throw new Error(`Clinic config ${clinicId} is missing "${key}"`);
    }
  }
  if (!Array.isArray(clinic.branches) || clinic.branches.length === 0) {
    throw new Error(`Clinic config ${clinicId} needs at least one branch`);
  }
  for (const branch of clinic.branches) {
    if (!branch.id || !branch.name || !branch.slots?.days?.length || !branch.slots?.times?.length) {
      throw new Error(`Branch "${branch.name || branch.id || "?"}" needs id, name, and slots`);
    }
  }
  clinic.bookingPrefix = clinic.bookingPrefix || clinic.id.slice(0, 2).toUpperCase();
  clinic.bookingWindowDays = clinic.bookingWindowDays || 10;
  clinic.minLeadMinutes = clinic.minLeadMinutes ?? 30;
  clinic.reminderLeadMinutes = clinic.reminderLeadMinutes ?? 120;
  clinic.closedDates = clinic.closedDates || [];
  return clinic;
}
