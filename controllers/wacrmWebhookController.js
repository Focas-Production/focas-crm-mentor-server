const crypto = require("crypto");
const {
  getWacrmContactPhone,
  sendTypingIndicator,
} = require("../services/whatsappService");
const {
  processInbound,
  belongsToDripEngine,
} = require("./watiWebhookController");

/**
 * Receives outbound webhook events from our wacrm instance
 * (wa.focasedu.online) and feeds inbound WhatsApp messages into the
 * MCQ bot.
 *
 * Env vars:
 * - WACRM_WEBHOOK_SECRET: whsec_... shown once when the webhook is
 *   registered via POST /api/v1/webhooks on wacrm.
 *
 * Signature: X-Wacrm-Signature: t=<unix_seconds>,v1=<hex> where
 * v1 = HMAC-SHA256(secret, `${t}.${rawBody}`). Requires server.js to
 * capture req.rawBody in express.json({ verify }).
 */

const SIGNATURE_TOLERANCE_SEC = 5 * 60;

// contact_id -> phone cache (bounded; wacrm events carry no phone)
const phoneCache = new Map();
const PHONE_CACHE_MAX = 5000;

function cachePhone(contactId, phone) {
  if (phoneCache.size >= PHONE_CACHE_MAX) {
    phoneCache.delete(phoneCache.keys().next().value);
  }
  phoneCache.set(contactId, phone);
}

function verifySignature(req) {
  const secret = process.env.WACRM_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[WACRM-WEBHOOK] WACRM_WEBHOOK_SECRET not set");
    return false;
  }
  if (!req.rawBody) {
    console.error("[WACRM-WEBHOOK] rawBody missing — check express.json verify hook");
    return false;
  }

  const header = req.get("X-Wacrm-Signature") || "";
  const match = header.match(/t=(\d+),v1=([0-9a-f]+)/);
  if (!match) return false;

  const [, t, v1] = match;
  if (Math.abs(Date.now() / 1000 - Number(t)) > SIGNATURE_TOLERANCE_SEC) {
    console.warn("[WACRM-WEBHOOK] Stale signature timestamp, rejecting");
    return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${t}.${req.rawBody}`)
    .digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

exports.wacrmWebhookHandler = async (req, res) => {
  if (!verifySignature(req)) {
    return res.sendStatus(401);
  }

  // ACK fast — wacrm delivery is single-attempt with a short timeout.
  res.sendStatus(200);

  try {
    const event = req.body;
    if (event?.event !== "message.received") return;

    const {
      contact_id,
      whatsapp_message_id,
      content_type,
      text,
      // WATI-style enriched fields (wacrm ≥ 0.9): phone/wa_id, sender
      // name, and the structured interactive tap with the row ID.
      phone: eventPhone,
      wa_id,
      sender_name,
      interactive_reply,
    } = event.data || {};
    if (!contact_id || !text) return;

    // Bail out BEFORE the read receipt.
    //
    // processInbound() refuses these too, but returning there is already too
    // late to be silent: sendTypingIndicator() below marks the message read and
    // puts a "typing…" bubble on the learner's phone. The learner would see
    // this bot acknowledge their message and then say nothing — which reads as
    // a broken bot rather than a quiet one. While the drip engine owns the
    // conversation, leave no trace of having seen any of it.
    if (
      belongsToDripEngine({
        text,
        listReply: interactive_reply,
        // Needed for the ownership map: the trigger word claims the NUMBER, and
        // every message from it afterwards is theirs until it is handed back.
        waId: wa_id || eventPhone,
      })
    ) {
      console.log("[WACRM-WEBHOOK] Ignored — this conversation belongs to the drip engine");
      return;
    }

    // The bot WILL handle this message — mark it read + show "typing…"
    // on the customer's phone before the MCQ engine computes its reply.
    // Awaited so the ack reaches Meta before the reply dismisses it;
    // best-effort inside (never throws).
    await sendTypingIndicator(whatsapp_message_id);

    // Phone rides on the event now; the API lookup remains as a
    // fallback for events from an older wacrm build.
    let phone = eventPhone || wa_id || phoneCache.get(contact_id);
    if (!phone) {
      phone = await getWacrmContactPhone(contact_id);
      if (!phone) {
        console.error("[WACRM-WEBHOOK] Could not resolve phone for contact:", contact_id);
        return;
      }
    }
    cachePhone(contact_id, phone);

    // Normalize into the shape the bot expects (same as WATI's).
    const body = {
      id: whatsapp_message_id || event.id,
      waId: String(phone).replace(/\D/g, ""),
      senderName: sender_name || undefined,
      text,
    };
    if (interactive_reply) {
      // Structured tap: real row id + title (+ description) — the bot
      // can match by id instead of title.
      body.listReply = {
        id: interactive_reply.id,
        title: interactive_reply.title,
        description: interactive_reply.description || undefined,
      };
    } else if (content_type === "interactive") {
      // Older wacrm: only the tapped title travels (as `text`).
      body.listReply = { title: text };
    }

    await processInbound(body);
  } catch (error) {
    console.error("[WACRM-WEBHOOK] Error:", error);
  }
};
