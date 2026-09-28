# Grin & Glow WhatsApp agent

Enquiry, booking, and reminder flow for Grin & Glow Dental on the WhatsApp Cloud API. FAQs, branches, and slots live in `config/clinics/grin-glow.json`. Copy that file and change `CLINIC_ID` to reuse the same agent for another clinic.

## Tonight

```bash
npm test
npm run check
npm start
```

`npm test` books a visit from hello through the reminder. `npm run check` calls Graph API with the token in `.env`. `npm start` listens for WhatsApp on port 8787.

## Connect the test number

The test number already has an app callback. A phone-number override sends patient messages to this agent first. Clear it with `node scripts/connect-webhook.js --clear` to fall back to the app callback.

1. `npm start`
2. In another terminal: `cloudflared tunnel --url http://localhost:8787`
3. `node scripts/connect-webhook.js https://<the-trycloudflare-host>/webhook`
4. WhatsApp → API Setup → add your mobile as a test recipient, if it is not there already.
5. From that phone, send `hi` to **+1 555 100-1847**.

Verify token used by the override is `WHATSAPP_VERIFY_TOKEN` in `.env`.

The access token from API Setup expires (often within 24 hours). Keep it in `.env` only. If `npm run check` says the token was rejected, generate a new one and replace `WHATSAPP_TOKEN`.

## What the chat does

- **Book appointment** — branch, visit type, day, time, name, confirm. The slot is then blocked.
- **Ask a question** — answers come from the `faqs` list in the clinic config. Anything not listed gets a short handoff to the desk.
- **Reminder** — saved for 2 hours before the visit (`reminderLeadMinutes`). The running server sends it on WhatsApp. Reply `YES` to confirm you are coming, or `BOOK` to start again.

Session messages work for 24 hours after the patient writes in. A reminder outside that window needs an approved WhatsApp template; the pilot sends a normal session message.

## Another clinic

Copy `config/clinics/grin-glow.json` to a new id, edit the name, FAQs, branches, and slot times, then set `CLINIC_ID` in `.env`.
