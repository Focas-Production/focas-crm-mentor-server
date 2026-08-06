const axios = require("axios");

/**
 * WhatsApp messaging via our own Meta Cloud API number (replaces WATI).
 *
 * Env vars:
 * - WHATSAPP_PHONE_NUMBER_ID: Meta phone number id (e.g. 1280380925150776)
 * - WHATSAPP_ACCESS_TOKEN: Meta Graph API access token
 * - WHATSAPP_OTP_TEMPLATE: approved AUTHENTICATION template name (e.g. "focas_otp")
 * - WHATSAPP_TEMPLATE_LANGUAGE: template language code (default "en_US")
 * - WACRM_BASE_URL: wacrm instance URL (e.g. https://wa.focasedu.online)
 * - WACRM_API_KEY: wacrm public API key (wacrm_live_...)
 */

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

const toE164Digits = (phoneNumber) => String(phoneNumber).replace(/\D/g, "");

/**
 * Send an OTP using our approved AUTHENTICATION template, directly via
 * the Meta Cloud API. Authentication templates require the code in both
 * the body and the copy-code button component.
 */
const sendOtpMessage = async (phoneNumber, otp) => {
  const to = toE164Digits(phoneNumber);
  const url = `${GRAPH_API_BASE}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: process.env.WHATSAPP_OTP_TEMPLATE || "focas_otp",
      language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en_US" },
      components: [
        {
          type: "body",
          parameters: [{ type: "text", text: String(otp) }],
        },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: String(otp) }],
        },
      ],
    },
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      },
    });
    return response.data;
  } catch (error) {
    console.error(
      "WhatsApp OTP send error:",
      JSON.stringify(error.response?.data || error.message)
    );
    throw error;
  }
};

/**
 * Send a message through the wacrm public API (shows up in the shared
 * inbox at WACRM_BASE_URL). Use for non-OTP messages so agents can see
 * the conversation history.
 *
 * message: { type: "text", text } or
 *          { type: "template", template: { name, language, params } } or
 *          { type: "image"|"video"|"document"|"audio", media_url, text, filename }
 */
const sendWacrmMessage = async (phoneNumber, message) => {
  const to = "+" + toE164Digits(phoneNumber);
  const url = `${process.env.WACRM_BASE_URL}/api/v1/messages`;

  try {
    const response = await axios.post(
      url,
      { to, ...message },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.WACRM_API_KEY}`,
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error(
      "wacrm send error:",
      JSON.stringify(error.response?.data || error.message)
    );
    throw error;
  }
};

/** Send a plain text message via wacrm. Returns null on failure. */
const sendWacrmText = async (phoneNumber, text) => {
  try {
    return await sendWacrmMessage(phoneNumber, { type: "text", text });
  } catch {
    return null;
  }
};

/**
 * Send an interactive list message via wacrm.
 * rows: [{ id, title, description? }] — max 10 total.
 */
const sendWacrmInteractiveList = async (
  phoneNumber,
  { body, buttonLabel, sectionTitle, rows }
) => {
  try {
    return await sendWacrmMessage(phoneNumber, {
      type: "interactive",
      interactive_payload: {
        kind: "list",
        body,
        button_label: buttonLabel,
        sections: [
          {
            title: sectionTitle,
            rows: rows.map((r) =>
              r.description
                ? { id: r.id, title: r.title, description: r.description }
                : { id: r.id, title: r.title }
            ),
          },
        ],
      },
    });
  } catch {
    return null;
  }
};

/** Look up a wacrm contact's phone number by contact id. */
const getWacrmContactPhone = async (contactId) => {
  try {
    const response = await axios.get(
      `${process.env.WACRM_BASE_URL}/api/v1/contacts/${contactId}`,
      {
        headers: { Authorization: `Bearer ${process.env.WACRM_API_KEY}` },
        timeout: 15000,
      }
    );
    return response.data?.data?.phone || null;
  } catch (error) {
    console.error(
      "wacrm contact lookup error:",
      JSON.stringify(error.response?.data || error.message)
    );
    return null;
  }
};

module.exports = {
  sendOtpMessage,
  sendWacrmMessage,
  sendWacrmText,
  sendWacrmInteractiveList,
  getWacrmContactPhone,
};
