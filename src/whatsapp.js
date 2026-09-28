export function extractMessages(body) {
  const messages = [];
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      const phoneNumberId = change.value?.metadata?.phone_number_id || "";
      for (const message of change.value?.messages || []) {
        messages.push(normalizeMessage(message, phoneNumberId));
      }
    }
  }
  return messages;
}

function normalizeMessage(message, phoneNumberId) {
  const base = {
    from: message.from,
    messageId: message.id,
    type: message.type,
    phoneNumberId,
    text: "",
    id: "",
  };
  if (message.type === "text") {
    return { ...base, text: message.text?.body || "" };
  }
  if (message.type === "interactive") {
    const reply = message.interactive?.button_reply || message.interactive?.list_reply;
    return { ...base, text: reply?.title || "", id: reply?.id || "" };
  }
  if (message.type === "button") {
    return { ...base, text: message.button?.text || "", id: message.button?.payload || "" };
  }
  return { ...base, unsupported: true };
}

function clip(value, max) {
  const text = String(value ?? "").trim();
  return text.length <= max ? text : text.slice(0, max);
}

export function toCloudPayload(to, message) {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  if (message.type === "text") {
    return { ...base, type: "text", text: { preview_url: false, body: clip(message.text, 4096) } };
  }
  if (message.type === "buttons") {
    const buttons = message.buttons || [];
    if (buttons.length < 1 || buttons.length > 3) {
      throw new Error(`WhatsApp reply buttons must be 1 to 3, got ${buttons.length}`);
    }
    return {
      ...base,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: clip(message.body, 1024) },
        action: {
          buttons: buttons.map((button) => ({
            type: "reply",
            reply: { id: clip(button.id, 200), title: clip(button.title, 20) },
          })),
        },
      },
    };
  }
  if (message.type === "list") {
    const rows = message.rows || [];
    if (rows.length < 1 || rows.length > 10) {
      throw new Error(`WhatsApp list must be 1 to 10 rows, got ${rows.length}`);
    }
    return {
      ...base,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: clip(message.body, 1024) },
        action: {
          button: clip(message.button || "Choose", 20),
          sections: [
            {
              title: clip(message.section || "Options", 24),
              rows: rows.map((row) => {
                const item = {
                  id: clip(row.id, 200),
                  title: clip(row.title, 24),
                };
                if (row.description) item.description = clip(row.description, 72);
                return item;
              }),
            },
          ],
        },
      },
    };
  }
  throw new Error(`Unknown outbound message type: ${message.type}`);
}

export function asNumberedText(message) {
  if (message.type === "text") return message.text;
  const options = message.buttons || message.rows || [];
  const lines = [message.body, ""];
  options.forEach((option, index) => {
    const label = option.title;
    const extra = option.description ? ` — ${option.description}` : "";
    lines.push(`${index + 1}. ${label}${extra}`);
  });
  lines.push("", "Reply with a number.");
  return lines.join("\n");
}

async function postMessage(phoneNumberId, payload, { token, version }) {
  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = data.error?.message || `WhatsApp API ${response.status}`;
    const error = new Error(reason);
    error.code = data.error?.code;
    error.details = data.error;
    throw error;
  }
  return data;
}

export async function deliver(to, messages, options) {
  const sent = [];
  for (const message of messages) {
    const payload = toCloudPayload(to, message);
    if (options.dryRun) {
      sent.push({ dryRun: true, payload });
      continue;
    }
    try {
      const data = await postMessage(options.phoneNumberId, payload, options);
      sent.push({ payload, data });
    } catch (error) {
      if (message.type === "text") throw error;
      const fallback = toCloudPayload(to, { type: "text", text: asNumberedText(message) });
      const data = await postMessage(options.phoneNumberId, fallback, options);
      sent.push({ payload: fallback, data, fellBack: true, error: error.message });
    }
  }
  return sent;
}

export async function markRead(messageId, options) {
  if (!messageId || options.dryRun) return;
  try {
    await postMessage(
      options.phoneNumberId,
      { messaging_product: "whatsapp", status: "read", message_id: messageId },
      options,
    );
  } catch (error) {
    console.error(`mark read failed: ${error.message}`);
  }
}
