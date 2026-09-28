import http from "node:http";
import crypto from "node:crypto";
import { extractMessages } from "./whatsapp.js";

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function signatureOk(raw, header, secret) {
  if (!secret) return true;
  if (!header) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function createServer({ agent, verifyToken, appSecret, phoneNumberId, onMessages }) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    if (req.method === "GET" && pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "GET" && pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Grin & Glow WhatsApp agent is running.\n");
      return;
    }

    if (req.method === "GET" && pathname === "/webhook") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode === "subscribe" && token === verifyToken && challenge) {
        console.log("webhook verified");
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(challenge);
        return;
      }
      res.writeHead(403);
      res.end("forbidden");
      return;
    }

    if (req.method === "POST" && pathname === "/webhook") {
      let raw;
      try {
        raw = await readBody(req);
      } catch {
        res.writeHead(413);
        res.end("too large");
        return;
      }
      if (!signatureOk(raw, req.headers["x-hub-signature-256"], appSecret)) {
        res.writeHead(401);
        res.end("bad signature");
        return;
      }
      let body;
      try {
        body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
      } catch {
        res.writeHead(400);
        res.end("bad json");
        return;
      }
      const messages = extractMessages(body).filter(
        (message) => !phoneNumberId || !message.phoneNumberId || message.phoneNumberId === phoneNumberId,
      );
      try {
        if (onMessages) await onMessages(messages);
        else {
          for (const message of messages) await agent.handleMessage(message);
        }
      } catch (error) {
        console.error(`webhook handler failed: ${error.message}`);
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }

    res.writeHead(404);
    res.end("not found");
  });
}
