const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const User = require("../models/User");
const {
  sendWacrmText,
  sendWacrmInteractiveList,
} = require("../services/whatsappService");

const {
  generateMCQsFromPython,
  saveMCQGeneration,
  submitMCQAnswer,
} = require("../services/mcqService");

/* ========================================================= */
/* REDIS (PROD) + IN-MEM FALLBACK                             */
/* ========================================================= */
let redis;
const REDIS_URL = process.env.REDIS_URL;

if (REDIS_URL) {
  const IORedis = require("ioredis");
  redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: 1 });
  redis.on("error", (err) => console.error("[REDIS] Error:", err.message));
  console.log("[REDIS] Using REDIS_URL");
} else {
  const __mem = {};
  redis = {
    get: async (k) => __mem[k] ?? null,
    set: async (k, v, opt) => {
      __mem[k] = v;
      if (typeof opt === "number") {
        setTimeout(() => delete __mem[k], opt * 1000).unref();
      } else if (opt?.EX) {
        setTimeout(() => delete __mem[k], opt.EX * 1000).unref();
      }
    },
    del: async (k) => {
      delete __mem[k];
    },
  };
  console.warn("[REDIS] REDIS_URL not set. Using in-memory store.");
}

/* ========================================================= */
/* CONSTANTS + KEYS                                           */
/* ========================================================= */

const MAX_TEXT_LENGTH = 1000;
const OPTION_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DEFAULT_DIFFICULTY = "hard"; // Configurable: "easy", "medium", or "hard"
const MAX_LIST_ITEMS = 9; // Max items per page (reserve 10th for Next/Back)

const SESSION_KEY = (from) => `session:whatsapp:${from}`; // selection flow
const SIGNUP_KEY = (from) => `signup:whatsapp:${from}`; // name
const MCQ_KEY = (from) => `mcq:whatsapp:${from}`; // active quiz run
const DEDUPE_KEY = (id) => `dedupe:msg:${id}`; // message id dedupe
const DEDUPE_FALLBACK_KEY = (from, text, t) => `dedupe:fallback:${from}:${text}:${t}`; // fallback dedupe
const PROMPT_LOCK_KEY = (from) => `promptlock:${from}`; // prevents re-sending same step prompt

/* ========================================================= */
/* THE OTHER BOT'S TRIGGER WORD                               */
/* ========================================================= */

/**
 * The drip engine (Focas/drip_engine) runs its own quiz on THIS SAME wacrm
 * account, started by its own trigger word — `quiz` by default, configurable
 * there as the `quizTrigger` keeper setting.
 *
 * Both bots therefore receive every inbound message on this number, and before
 * this guard both answered that word: the drip engine opened its subject
 * chooser while this server replied "Type *MCQ* to begin a practice session"
 * (see the `if (!session)` branch in processInbound). Two bots talking over
 * each other in one chat, for one word the learner typed once.
 *
 * The word is not ours, so we do not act on it — we stay silent and let the
 * drip engine own it. This server's own trigger, `mcq`, is untouched.
 *
 * Keep QUIZ_TRIGGER_WORD in step with the drip engine's `quizTrigger` setting.
 * If they drift, this server starts answering the other bot's word again.
 */
const QUIZ_TRIGGER_WORD = (process.env.QUIZ_TRIGGER_WORD || "quiz").trim();

/**
 * Anchored and escaped, deliberately matching the drip engine's own rule
 * (src/services/mcqSession.js triggerPattern): the WHOLE message must be the
 * word. "how do I start the quiz" is a learner asking this mentor a question
 * and must still be handled normally — only the bare trigger is surrendered.
 */
const QUIZ_TRIGGER_RE = new RegExp(
  `^\\s*${QUIZ_TRIGGER_WORD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
  "i"
);

/**
 * True when this inbound is the drip engine's trigger and this server should
 * say nothing at all.
 *
 * Checks the tapped label as well as typed text: a WhatsApp quick reply arrives
 * as a message whose text is the button's label, so the tap and the typed word
 * look alike on the wire — which is exactly why the drip engine accepts both.
 */
function isOtherBotsQuizTrigger(body) {
  if (!QUIZ_TRIGGER_WORD) return false;
  const candidates = [
    body?.text,
    body?.message,
    body?.listReply?.title,
    body?.listReply?.id,
    body?.buttonReply?.title,
  ];
  return candidates.some((c) => c && QUIZ_TRIGGER_RE.test(String(c)));
}

/* ========================================================= */
/* WHO OWNS THIS CONVERSATION                                 */
/* ========================================================= */

/**
 * The trigger word alone is not enough.
 *
 * Surrendering the bare word `quiz` stopped this server answering the moment a
 * quiz STARTS, but not for the rest of it. Every question the drip engine asks
 * comes back as a tapped row, and this server answered every one of them —
 * three interruptions per quiz. From production on 26 Aug, one tap:
 *
 *   12:31:18  IN  <- "B"   interactive_reply.id = drip:6a8e8f35...:B
 *   12:31:19  OUT -> "❌ Incorrect. Correct Answer: A ..."
 *   12:31:20  OUT -> "❌ Not quite. The answer is D ..."
 *   12:31:21  OUT -> "Quiz Completed! 📊 Your Score: 0/1"
 *
 * Two verdicts a second apart, disagreeing because they were grading two
 * different questions, then a score for a quiz the learner was not taking.
 *
 * So ownership is tracked per number rather than per message. `quiz` hands the
 * conversation to the drip engine, `mcq` hands it back, and while they hold it
 * this server says nothing at all — taps, free text, all of it.
 */

/**
 * Every tappable row the drip engine mints carries an id in its own namespace
 * (`drip:subj:IDT`, `drip:6a8e8f35...:B`). Ids are minted by whoever sent the
 * row, so this prefix can only ever be theirs.
 *
 * Unlike QUIZ_TRIGGER_WORD this needs no configuration and cannot drift — it is
 * the half of the protocol that is safe to hard-code.
 */
const DRIP_ID_PREFIX = "drip:";

/**
 * The handback. This server's own trigger, matched the same way processInbound
 * matches it further down, so "the word that starts an MCQ session" and "the
 * word that takes the conversation back" cannot disagree.
 */
const HANDBACK_RE = /^\s*\/?mcq\s*$/i;

/**
 * Released after this long without a word from the number.
 *
 * Without a timeout, releasing ONLY on `mcq` would leave anyone who finishes a
 * drip quiz talking to nobody: the drip engine has closed its session and this
 * server still believes it must stay quiet. That silence is worse than the
 * double reply it was meant to fix. A drip quiz is three questions and takes
 * about a minute, so thirty is generous by a wide margin.
 */
const DRIP_OWNERSHIP_TIMEOUT_MS = 30 * 60 * 1000;

/** waId (digits only) -> epoch ms of the last message that kept it theirs. */
const dripOwned = new Map();

/**
 * In-memory on purpose. Losing it on restart costs at most one duplicate reply
 * before the next tap or trigger puts the number back — which is a far smaller
 * price than a shared store between two servers that are meant to stay
 * independent.
 */
function pruneDripOwned(now) {
  if (dripOwned.size < 500) return;
  for (const [key, seen] of dripOwned) {
    if (now - seen > DRIP_OWNERSHIP_TIMEOUT_MS) dripOwned.delete(key);
  }
}

function dripOwnerKey(body) {
  const explicit = body?.waId || body?.wa_id || body?.phone;
  if (explicit) return String(explicit).replace(/\D/g, "") || null;
  // The wacrm controller hands us a small object it built by hand; a full WATI
  // body has to go through the normaliser instead.
  try {
    const from = normalizeIncomingFrom(body);
    return from ? String(from).replace(/\D/g, "") || null : null;
  } catch {
    return null;
  }
}

/**
 * True when the drip engine owns this conversation turn and this server should
 * say nothing at all.
 *
 * Order matters: handback is checked before everything, so `mcq` always gets
 * the learner out no matter what state the map is in.
 */
function belongsToDripEngine(body, now = Date.now()) {
  const key = dripOwnerKey(body);
  const labels = [body?.text, body?.message, body?.listReply?.title, body?.buttonReply?.title];

  if (labels.some((c) => c && HANDBACK_RE.test(String(c)))) {
    if (key) dripOwned.delete(key);
    return false;
  }

  // A row in their namespace is theirs whether or not the map agrees — this is
  // what survives a restart, and what makes the map an optimisation rather than
  // the thing correctness rests on.
  if (String(body?.listReply?.id || "").startsWith(DRIP_ID_PREFIX)) {
    if (key) {
      pruneDripOwned(now);
      dripOwned.set(key, now);
    }
    return true;
  }

  if (isOtherBotsQuizTrigger(body)) {
    if (key) {
      pruneDripOwned(now);
      dripOwned.set(key, now);
    }
    return true;
  }

  // Everything else from a number mid-quiz: free text between taps, "ok",
  // "what is this?" — the case the trigger-word rule could never cover.
  if (!key) return false;
  const seen = dripOwned.get(key);
  if (seen === undefined) return false;
  if (now - seen > DRIP_OWNERSHIP_TIMEOUT_MS) {
    dripOwned.delete(key);
    return false;
  }
  dripOwned.set(key, now);
  return true;
}

/* ========================================================= */
/* THE CA GURU CAMPAIGN                                       */
/* ========================================================= */

/**
 * The CA Guru bot (Focas/ca_guru_bot) answers leads from the "Your Last Attempt"
 * campaign on this same wacrm number. A lead starts it by sending the ad's
 * prefilled text, and from then on it asks them numbered questions ("Reply with
 * the number"). Before this guard this server answered every one of those
 * messages too: a lead's "2" got our "Type *MCQ* to begin" menu while the CA
 * Guru bot moved on to its next question.
 *
 * So the phrase hands the NUMBER to the CA Guru bot for CAGURU_SILENCE_HOURS
 * (two days by default) and this server says nothing to it at all in that time
 * — typed `mcq` included. After that it answers them as usual.
 *
 * Kept in Redis, not in memory like the drip map: two days is long enough that a
 * restart inside it is likely, and the first message after one would be a
 * double reply in exactly the chat this is meant to protect.
 *
 * Keep CAGURU_TRIGGER_PHRASE in step with BOT_TRIGGER_PHRASE on the CA Guru bot.
 * Blank switches the guard off.
 */
const CAGURU_TRIGGER_PHRASE = (process.env.CAGURU_TRIGGER_PHRASE ?? "YOUR LAST ATTEMPT").trim();
const CAGURU_SILENCE_SEC = Math.round(Number(process.env.CAGURU_SILENCE_HOURS || 48) * 3600);
const CAGURU_KEY = (waId) => `caguru:owned:${waId}`;

/** The CA Guru bot's own normalisation: case, punctuation and spacing never break a match. */
const normalizePhrase = (v) =>
  String(v ?? "")
    .toLowerCase()
    .replace(/['‘’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The phrase anywhere in the message, as whole words — the same rule the CA Guru bot uses. */
function hasCaGuruTrigger(text) {
  const phrase = normalizePhrase(CAGURU_TRIGGER_PHRASE);
  return Boolean(phrase) && ` ${normalizePhrase(text)} `.includes(` ${phrase} `);
}

/**
 * True when the CA Guru bot owns this conversation and this server should say
 * nothing at all. Sending the phrase again restarts the two days.
 *
 * A Redis failure answers "no": this server's own learners going unanswered is
 * worse than one double reply to a lead.
 */
async function belongsToCaGuru(body) {
  const key = dripOwnerKey(body);
  if (!key || !CAGURU_TRIGGER_PHRASE) return false;
  try {
    if ([body?.text, body?.message].some((t) => t && hasCaGuruTrigger(t))) {
      await setJson(CAGURU_KEY(key), { since: new Date().toISOString() }, CAGURU_SILENCE_SEC);
      return true;
    }
    return Boolean(await getJson(CAGURU_KEY(key)));
  } catch (err) {
    console.error("[CAGURU] Ownership check failed:", err.message);
    return false;
  }
}

/* ========================================================= */
/* ATTEMPT GIVEN OPTIONS                                      */
/* ========================================================= */

const ATTEMPT_GIVEN_OPTIONS = [
  'Foundation - Sep -2026',
  'Foundation - Jan -2027',
  'Intermediate - Sep -2026',
  'Intermediate - Jan -2027',
  'Final - Sep -2026',
  'Final - Jan -2027',
];

const CA_LEVEL_MAP = {
  Foundation: 'CA Foundation',
  Intermediate: 'CA Intermediate',
  Final: 'CA Final',
};

const CA_LEVEL_SHORT_MAP = {
  'CA Foundation': 'Foundation',
  'CA Intermediate': 'Intermediate',
  'CA Final': 'Final',
};

// Attempt expiry dates (exam month end)
const ATTEMPT_EXPIRY = {
  'Sep -2026': new Date('2026-12-31T23:59:59Z'),
  'Jan -2027': new Date('2027-01-31T23:59:59Z'),
};

function isAttemptExpired(attemptGiven) {
  if (!attemptGiven) return true;
  const expiry = ATTEMPT_EXPIRY[attemptGiven];
  if (!expiry) return true;
  return new Date() > expiry;
}

function parseAttemptOption(option) {
  const trimmed = String(option || '').trim();
  for (const level of ['Foundation', 'Intermediate', 'Final']) {
    for (const attempt of ['Sep -2026', 'Jan -2027']) {
      if (trimmed.toLowerCase() === `${level} - ${attempt}`.toLowerCase()) {
        return { level, attemptGiven: attempt, caLevel: CA_LEVEL_MAP[level] };
      }
    }
  }
  return null;
}

function caLevelToShort(caLevel) {
  return CA_LEVEL_SHORT_MAP[caLevel] || null;
}

const DEDUPE_TTL_SEC = 60 * 10; // 10 minutes
const PROMPT_LOCK_TTL_SEC = 20; // seconds (enough for immediate replays)

/* ========================================================= */
/* ENV + BASE URLS                                            */
/* ========================================================= */

const DATA_API_BASE_URL = process.env.DATA_API_BASE_URL || "http://31.97.228.184:5555";

/* ========================================================= */
/* INTERACTIVE LIST MESSAGE (via wacrm)                       */
/* ========================================================= */

async function sendInteractiveListMessage({
  whatsappNumber,
  bodyText,
  buttonText,
  sectionTitle,
  rows
}) {
  const result = await sendWacrmInteractiveList(whatsappNumber, {
    body: bodyText,
    buttonLabel: buttonText,
    sectionTitle,
    rows,
  });
  if (result) {
    console.log("[WACRM] ✅ Interactive List Sent:", whatsappNumber);
  } else {
    console.error("[WACRM] ❌ Interactive List failed:", whatsappNumber);
  }
  return result;
}

/* ========================================================= */
/* SESSION TEXT MESSAGE (via wacrm)                           */
/* ========================================================= */

async function sendWatiSessionMessage(phoneNumber, messageText) {
  const result = await sendWacrmText(phoneNumber, messageText);
  if (result) {
    console.log("[WACRM] ✅ Sent:", phoneNumber);
  } else {
    console.error("[WACRM] ❌ Send failed:", phoneNumber);
  }
  return result;
}

/* ========================================================= */
/* DATA API (GET)                                             */
/* ========================================================= */

async function getSubjects(level) {
  try {
    const r = await axios.get(`${DATA_API_BASE_URL}/api/data/subjects`, {
      params: { level },
      timeout: 20000,
    });
    return r.data || [];
  } catch (e) {
    console.error("[DATA API] subjects error:", e.message);
    return [];
  }
}

async function getChapters(level, subject) {
  try {
    const r = await axios.get(`${DATA_API_BASE_URL}/api/data/chapters`, {
      params: { level, subject },
      timeout: 20000,
    });
    return r.data || [];
  } catch (e) {
    console.error("[DATA API] chapters error:", e.message);
    return [];
  }
}

async function getUnits(chapter) {
  try {
    const r = await axios.get(`${DATA_API_BASE_URL}/api/data/units`, {
      params: { chapter_name: chapter },
      timeout: 20000,
    });
    const arr = r.data || [];
    return arr.map((u) => u.unit_name).filter(Boolean);
  } catch (e) {
    console.error("[DATA API] units error:", e.message);
    return [];
  }
}

/* ========================================================= */
/* HELPER FUNCTIONS                                           */
/* ========================================================= */

function digitsOnly(v) {
  return String(v || "").replace(/[^\d]/g, "");
}

function normalizeIncomingFrom(body) {
  return String(body?.from || body?.waId || "").trim();
}

function getIncomingText(body) {
  // Handle interactive list response
  if (body?.listReply?.title) {
    return String(body.listReply.title).trim();
  }
  
  // Handle button response
  if (body?.buttonReply?.title) {
    return String(body.buttonReply.title).trim();
  }

  // Regular text message
  const raw = body?.text ?? body?.message ?? "";
  return String(raw || "").trim().slice(0, MAX_TEXT_LENGTH);
}

// Get the list reply ID which contains the index
function getListReplyId(body) {
  return body?.listReply?.id || null;
}

// Updated pickOption to handle pagination navigation and ID-based matching
function pickOption(input, options, listReplyId = null, currentPage = 0, opts = {}) {
  const listReplyTitle = opts.listReplyTitle;
  const listReplyDescription = opts.listReplyDescription;
  const isListReply = Boolean(opts.isListReply);

  // Check for navigation commands
  const inputLower = String(input || "").trim().toLowerCase();
  
  if (inputLower === "next" || inputLower === "➡️ next") {
    return { action: "NEXT_PAGE" };
  }
  
  if (inputLower === "back" || inputLower === "⬅️ back") {
    return { action: "PREV_PAGE" };
  }

  const n = inputLower;

  // If this is an interactive list reply, prefer matching by title/description over numbers
  if (isListReply && (listReplyTitle || listReplyDescription)) {
    const titleLower = String(listReplyTitle || "").trim().toLowerCase();
    const descLower = String(listReplyDescription || "").trim().toLowerCase();

    const exactTitleMatch = options.find(
      (o) => String(o).trim().toLowerCase() === titleLower
    );
    if (exactTitleMatch) {
      console.log("[PICK_OPTION] Matched by list reply title:", exactTitleMatch);
      return { action: "SELECT", value: exactTitleMatch };
    }

    const sanitizedMatch = options.find((o) => {
      const { title, description } = sanitizeRowText(o);
      const optTitle = String(title || "").trim().toLowerCase();
      const optDesc = String(description || "").trim().toLowerCase();
      return (titleLower && optTitle === titleLower) || (descLower && optDesc === descLower);
    });

    if (sanitizedMatch) {
      console.log("[PICK_OPTION] Matched by sanitized list reply:", sanitizedMatch);
      return { action: "SELECT", value: sanitizedMatch };
    }
  }

  // If we have a listReplyId like "nav-next" or "nav-back"
  if (listReplyId) {
    if (listReplyId === "nav-next") {
      return { action: "NEXT_PAGE" };
    }
    if (listReplyId === "nav-back") {
      return { action: "PREV_PAGE" };
    }

    // Regular ID like "0-3" (page-index)
    const parts = String(listReplyId).split("-");
    if (parts.length === 2) {
      const page = parseInt(parts[0], 10);
      const idx = parseInt(parts[1], 10);

      // Calculate actual index in full options array
      const actualIndex = (page * MAX_LIST_ITEMS) + idx;

      if (actualIndex >= 0 && actualIndex < options.length) {
        console.log("[PICK_OPTION] Matched by ID:", listReplyId, "->", options[actualIndex]);
        return { action: "SELECT", value: options[actualIndex] };
      }
    }
  }

  // For list replies, avoid guessing with partial matches
  if (isListReply) {
    console.log("[PICK_OPTION] List reply unmatched, not guessing:", {
      title: listReplyTitle,
      description: listReplyDescription,
      id: listReplyId
    });
    return null;
  }

  // Exact text match (case insensitive)
  const exactMatch = options.find((o) => String(o).trim().toLowerCase() === n);
  if (exactMatch) {
    console.log("[PICK_OPTION] Exact match:", n, "->", exactMatch);
    return { action: "SELECT", value: exactMatch };
  }

  // number selection: "1", "2", ... (relative to current page)
  if (/^\d+$/.test(n)) {
    const relativeIdx = Number(n) - 1;
    const actualIdx = (currentPage * MAX_LIST_ITEMS) + relativeIdx;
    
    if (actualIdx >= 0 && actualIdx < options.length) {
      console.log("[PICK_OPTION] Matched by number:", n, "->", options[actualIdx]);
      return { action: "SELECT", value: options[actualIdx] };
    }
  }

  // Partial match
  const partialMatch = options.find((o) => {
    const optLower = String(o).trim().toLowerCase();
    return optLower.startsWith(n) || n.startsWith(optLower.substring(0, Math.min(20, optLower.length)));
  });

  if (partialMatch) {
    console.log("[PICK_OPTION] Partial match:", n, "->", partialMatch);
    return { action: "SELECT", value: partialMatch };
  }

  console.log("[PICK_OPTION] No match found for:", n);
  return null;
}

async function getJson(key) {
  const v = await redis.get(key);
  return v ? JSON.parse(v) : null;
}

async function setJson(key, val, ttlSec) {
  if (ttlSec) {
    if (REDIS_URL) {
      await redis.set(key, JSON.stringify(val), "EX", ttlSec);
    } else {
      await redis.set(key, JSON.stringify(val), ttlSec);
    }
    return;
  }
  await redis.set(key, JSON.stringify(val));
}

async function delKey(key) {
  await redis.del(key);
}

function isUserInboundMessage(body) {
  if (!body || typeof body !== "object") return false;

  // Common WATI flags (varies by payload)
  if (body.isOwner === true) return false;
  if (body.isGroup === true) return false;

  // If message object exists
  if (body.message && body.message.isOwner === true) return false;

  // Allow interactive messages
  if (body.listReply || body.buttonReply) {
    console.log("[DEBUG] Interactive message detected");
    return true;
  }

  // Many WATI payloads include eventType/statusType
  if (body.eventType && body.eventType !== "message") return false;
  if (body.statusType && body.statusType !== "message") return false;

  // Must have from + text-ish content
  const from = normalizeIncomingFrom(body);
  const txt = getIncomingText(body);
  
  if (!from || !txt) return false;

  return true;
}

async function dedupeOrSkip(from, text, messageId) {
  if (messageId) {
    const k = DEDUPE_KEY(messageId);
    const seen = await redis.get(k);
    if (seen) return true;
    if (REDIS_URL) {
      await redis.set(k, "1", "EX", DEDUPE_TTL_SEC);
    } else {
      await redis.set(k, "1", DEDUPE_TTL_SEC);
    }
    return false;
  }

  // fallback: dedupe by time bucket (10s)
  const bucket = Math.floor(Date.now() / 10000);
  const k2 = DEDUPE_FALLBACK_KEY(from, text.toLowerCase(), bucket);
  const seen2 = await redis.get(k2);
  if (seen2) return true;
  if (REDIS_URL) {
    await redis.set(k2, "1", "EX", DEDUPE_TTL_SEC);
  } else {
    await redis.set(k2, "1", DEDUPE_TTL_SEC);
  }
  return false;
}

async function canSendStepPrompt(from, step) {
  const lock = await getJson(PROMPT_LOCK_KEY(from));
  if (lock?.step === step) return false;
  await setJson(PROMPT_LOCK_KEY(from), { step, at: Date.now() }, PROMPT_LOCK_TTL_SEC);
  return true;
}

/* ========================================================= */
/* MCQ RUN HELPERS                                            */
/* ========================================================= */

function formatMCQQuestion(mcq, index, total) {
  const body = (mcq.options || []).join("\n");
  return `*Q${index + 1}/${total}*\n${mcq.question}\n\n${body}`;
}

function parseAnswer(rawText, options = []) {
  const val = String(rawText || "").trim();
  if (!val) return null;

  const upper = val.toUpperCase();

  // A/B/C
  if (/^[A-Z]$/.test(upper)) {
    const idx = OPTION_LETTERS.indexOf(upper);
    if (idx >= 0 && idx < options.length) return OPTION_LETTERS[idx];
  }

  // 1/2/3
  if (/^\d+$/.test(val)) {
    const n = Number(val);
    if (n >= 1 && n <= options.length) return OPTION_LETTERS[n - 1];
  }

  return null;
}

async function getMCQRun(from) {
  return getJson(MCQ_KEY(from));
}

async function setMCQRun(from, run) {
  await setJson(MCQ_KEY(from), run);
}

async function clearMCQRun(from) {
  await delKey(MCQ_KEY(from));
}

async function sendNextMCQ(from, run) {
  const current = run.mcqs[run.index];
  if (!current) return false;
  await sendWatiSessionMessage(from, formatMCQQuestion(current, run.index, run.total));
  const listSent = await showInteractiveOptions(
    from,
    "Choose your answer",
    "Answer",
    "Options",
    ["A", "B", "C", "D", "STOP"],
    0
  );
  if (!listSent) {
    await sendWatiSessionMessage(from, "Reply with A/B/C/D or 1/2/3/4. Type STOP to end.");
  }
  return true;
}

function normalizePythonMcqResponse(resp) {
  if (!resp) return { mcqs: [], error: "Empty response from MCQ API" };
  if (Array.isArray(resp)) return { mcqs: resp };
  if (resp.success === false) {
    return { mcqs: [], error: resp.error || "MCQ API returned failure" };
  }
  if (Array.isArray(resp.mcqs)) return { mcqs: resp.mcqs };
  return { mcqs: [], error: "Invalid MCQ API response format" };
}

/* ========================================================= */
/* HELPER: Sanitize text for WhatsApp Interactive Lists       */
/* Meta WhatsApp Limits:                                      */
/* - Header: max 60 characters                                */
/* - Body: max 1024 characters                                */
/* - Footer: max 60 characters                                */
/* - Button text: max 20 characters                           */
/* - Section title: max 24 characters                         */
/* - Row title: max 24 characters                             */
/* - Row description: max 72 characters                       */
/* ========================================================= */

function sanitizeRowText(text) {
  if (!text) return { title: "", description: "" };
  
  const cleanText = String(text).trim();
  
  // If text fits in title (24 chars), use it as title with empty description
  if (cleanText.length <= 24) {
    return {
      title: cleanText,
      description: ""
    };
  }
  
  // Text exceeds 24 chars - truncate title and use full text in description
  const truncatedTitle = cleanText.substring(0, 21) + "..."; // 21 + 3 dots = 24
  const description = cleanText.length <= 72 
    ? cleanText 
    : cleanText.substring(0, 69) + "..."; // 69 + 3 dots = 72
  
  return {
    title: truncatedTitle,
    description: description
  };
}

function truncateText(text, maxLength = 24) {
  if (!text) return "";
  text = String(text).trim();
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + "...";
}

/* ========================================================= */
/* PAGINATED INTERACTIVE OPTIONS DISPLAY                      */
/* ========================================================= */

async function showPaginatedOptions(from, bodyText, buttonText, sectionTitle, allOptions, currentPage = 0) {
  const totalPages = Math.ceil(allOptions.length / MAX_LIST_ITEMS);
  
  // If options fit in one page, show normally
  if (allOptions.length <= MAX_LIST_ITEMS) {
    const rows = allOptions.map((opt, idx) => {
      const sanitized = sanitizeRowText(opt);
      return {
        title: sanitized.title,
        description: sanitized.description,
        id: `0-${idx}`
      };
    });

    return sendInteractiveListMessage({
      whatsappNumber: from,
      bodyText: truncateText(bodyText, 1024),
      buttonText: truncateText(buttonText, 20),
      sectionTitle: truncateText(sectionTitle, 24),
      rows: rows
    });
  }

  // Multi-page scenario
  const startIdx = currentPage * MAX_LIST_ITEMS;
  const endIdx = Math.min(startIdx + MAX_LIST_ITEMS, allOptions.length);
  const pageOptions = allOptions.slice(startIdx, endIdx);

  const rows = pageOptions.map((opt, idx) => {
    const sanitized = sanitizeRowText(opt);
    return {
      title: sanitized.title,
      description: sanitized.description,
      id: `${currentPage}-${idx}` // page-index format
    };
  });

  // Add navigation buttons with proper sanitization
  if (currentPage > 0) {
    rows.push({
      title: "⬅️ Back",
      description: "",
      id: "nav-back"
    });
  }

  if (currentPage < totalPages - 1) {
    rows.push({
      title: "➡️ Next",
      description: "",
      id: "nav-next"
    });
  }

  const paginatedBodyText = `${bodyText}\n\n📄 Page ${currentPage + 1} of ${totalPages}`;

  return sendInteractiveListMessage({
    whatsappNumber: from,
    bodyText: truncateText(paginatedBodyText, 1024),
    buttonText: truncateText(buttonText, 20),
    sectionTitle: truncateText(sectionTitle, 24),
    rows: rows
  });
}

/* ========================================================= */
/* INTERACTIVE OPTIONS DISPLAY (WRAPPER)                      */
/* ========================================================= */

async function showInteractiveOptions(from, bodyText, buttonText, sectionTitle, options, currentPage = 0) {
  return showPaginatedOptions(from, bodyText, buttonText, sectionTitle, options, currentPage);
}

/* ========================================================= */
/* SHOW ACTION BUTTONS (Generate More / Different / STOP)    */
/* ========================================================= */

async function showActionButtons(from) {
  return showInteractiveOptions(
    from,
    "What would you like to do next?",
    "Select an Option",
    "Actions",
    ["Generate More", "Different Question", "Change Level", "STOP"],
    0
  );
}

/* ========================================================= */
/* MAIN WEBHOOK HANDLER                                        */
/* ========================================================= */

exports.webhookHandler = async (req, res) => {
  console.log(req.body)

  // ACK immediately
  res.sendStatus(200);

  await processInbound(req.body);
};

/**
 * Core bot logic, transport-agnostic. `body` is the normalized inbound
 * shape: { id, waId, text, listReply?: { id?, title, description? } }.
 * Called by webhookHandler (legacy WATI) and wacrmWebhookController.
 */
const processInbound = async (body) => {
  try {
    // Filter out non-user messages
    if (!isUserInboundMessage(body)) {
      console.log("[WEBHOOK] Ignored non-user event");
      return;
    }

    // Not our word. The drip engine owns `quiz` on this shared number and is
    // already answering it; anything this server said here would arrive as a
    // second bot talking over the first. Checked before dedupe and before any
    // state is loaded, so there is no path from here to a reply.
    if (belongsToDripEngine(body)) {
      console.log("[WEBHOOK] Ignored — this conversation belongs to the drip engine");
      return;
    }

    // A "Your Last Attempt" lead: the CA Guru bot is asking them numbered
    // questions for two days, and a "2" meant for it must not start our menu.
    if (await belongsToCaGuru(body)) {
      console.log("[WEBHOOK] Ignored — this conversation belongs to the CA Guru bot");
      return;
    }

    const from = normalizeIncomingFrom(body);
    const rawText = getIncomingText(body);
    const text = rawText.toLowerCase();
    const messageId = body.id || body.whatsappMessageId || body.messageId;
    const listReplyId = getListReplyId(body);
    const listReplyInfo = {
      isListReply: Boolean(body?.listReply),
      listReplyTitle: body?.listReply?.title,
      listReplyDescription: body?.listReply?.description
    };

    // DEDUPE
    const shouldSkip = await dedupeOrSkip(from, rawText, messageId);
    if (shouldSkip) {
      console.log("[WEBHOOK] Duplicate detected. Skipping.");
      return;
    }

    console.log("\n[WEBHOOK] From:", from);
    console.log("[WEBHOOK] Text:", rawText);
    console.log("[WEBHOOK] List Reply ID:", listReplyId);

    const phoneDigits = digitsOnly(from);
    const phonee = phoneDigits.slice(-10);

    // Load state
    let session = await getJson(SESSION_KEY(from));
    let signup = await getJson(SIGNUP_KEY(from));
    let user = await User.findOne({ phoneNumber: phonee });

    /* ===================================================== */
    /* ACTIVE MCQ ANSWER FLOW                                 */
    /* ===================================================== */

   /* ===================================================== */
/* ACTIVE MCQ ANSWER FLOW (FIXED – sequential questions)  */
/* ===================================================== */

const mcqRun = await getMCQRun(from);

if (mcqRun) {

  /* ================= STOP ================= */
  if (text === "stop") {
    await clearMCQRun(from);
    await sendWatiSessionMessage(from, "Your quiz session has been ended. Thank you for practising with us.\n\nType *MCQ* to begin a new session.");
    return;
  }

  /* ===================================================== */
  /* AFTER QUIZ COMPLETED → ACTION MENU                     */
  /* ===================================================== */

  if (mcqRun.waitingForAction) {

    if (text === "generate more") {
      mcqRun.waitingForAction = false;
      mcqRun.waitingForMoreCount = true;
      await setMCQRun(from, mcqRun);

      await showInteractiveOptions(
        from,
        "How many additional questions would you like?",
        "Select Count",
        "Number of Questions",
        ["1", "3", "5"],
        0
      );
      return;
    }

    if (text === "different question") {
      await clearMCQRun(from);

      // If attempt is valid, skip level selection
      const diffLevel = caLevelToShort(user?.caLevel);
      if (diffLevel && user?.attemptGiven && !isAttemptExpired(user.attemptGiven)) {
        const diffSubjects = await getSubjects(diffLevel);
        if (diffSubjects && diffSubjects.length > 0) {
          session = { step: "SUBJECT", data: { userId: user.userId, level: diffLevel, availableSubjects: diffSubjects, page: 0 } };
          await setJson(SESSION_KEY(from), session, 3600);
          await showInteractiveOptions(from, "Please select a subject to continue:", "Select Subject", "Subjects", diffSubjects, 0);
          return;
        }
      }

      session = { step: "LEVEL", data: { userId: user.userId, page: 0 } };
      await setJson(SESSION_KEY(from), session, 3600);

      await showInteractiveOptions(
        from,
        "Please select your CA Level to continue:",
        "Select Level",
        "CA Levels",
        ["Foundation", "Intermediate", "Final"],
        0
      );
      return;
    }

    if (text === "change level") {
      await clearMCQRun(from);
      session = { step: "ATTEMPT_GIVEN", data: { userId: user.userId, page: 0 } };
      await setJson(SESSION_KEY(from), session, 3600);
      if (await canSendStepPrompt(from, "ATTEMPT_GIVEN")) {
        await showInteractiveOptions(
          from,
          "Please select your updated *CA Level* and *Attempt Given*:",
          "Select",
          "CA Level & Attempt",
          ATTEMPT_GIVEN_OPTIONS,
          0
        );
      }
      return;
    }

    if (text === "stop") {
      await clearMCQRun(from);
      await sendWatiSessionMessage(from, "Your quiz session has been ended. Thank you for practising with us.\n\nType *MCQ* to begin a new session.");
      return;
    }

    await showActionButtons(from);
    return;
  }

  /* ===================================================== */
  /* ASKING "HOW MANY MORE?"                                */
  /* ===================================================== */

  if (mcqRun.waitingForMoreCount) {

    const picked = pickOption(rawText, ["1", "3", "5"], listReplyId, 0, listReplyInfo);

    if (!picked || picked.action !== "SELECT") {
      await showInteractiveOptions(
        from,
        "How many more questions?",
        "Choose Number",
        "Questions",
        ["1", "3", "5"],
        0
      );
      return;
    }

    const numQuestions = parseInt(picked.value, 10);

    await sendWatiSessionMessage(from, `Please wait while we generate ${numQuestions} additional question(s) for you...`);

    const payload = {
      userId: mcqRun.userId,
      ...mcqRun.context,
      numQuestions
    };

    const mcqResp = await generateMCQsFromPython(
      payload.level,
      payload.subject,
      payload.chapter,
      payload.unit,
      payload.difficulty,
      payload.numQuestions
    );

    const { mcqs, error } = normalizePythonMcqResponse(mcqResp);
    if (!mcqs.length) {
      if (error) {
        console.error("[WEBHOOK] MCQ API error:", error);
      }
      await sendWatiSessionMessage(from, "❌ Could not generate questions.");
      return;
    }

    const mcqIds = mcqs.map(() => uuidv4());

    await saveMCQGeneration(mcqRun.userId, mcqRun.context, mcqIds, mcqs);

    const newMcqs = mcqs.map((q, idx) => ({
      mcqId: mcqIds[idx],
      question: q.question,
      options: q.options,
    }));

    /* RESET QUIZ CLEANLY */
    mcqRun.mcqs = newMcqs;
    mcqRun.index = 0;
    mcqRun.correct = 0;
    mcqRun.total = newMcqs.length;
    mcqRun.waitingForMoreCount = false;

    await setMCQRun(from, mcqRun);

    await sendNextMCQ(from, mcqRun);
    return;
  }

  /* ===================================================== */
  /* NORMAL QUESTION ANSWER FLOW (THE IMPORTANT FIX)         */
  /* ===================================================== */

  const current = mcqRun.mcqs[mcqRun.index];

  if (!current) {
    await clearMCQRun(from);
    return;
  }

  const userAnswer = parseAnswer(rawText, current.options);

  if (!userAnswer) {
    await sendWatiSessionMessage(from, "Please reply with A, B, C, or D (or 1, 2, 3, or 4) to submit your answer.");
    return;
  }

  const result = await submitMCQAnswer(
    mcqRun.userId,
    current.mcqId,
    userAnswer,
    { timeSpent: 0 }
  );

  const isCorrect = result.evaluation.isCorrect;
  const correctAnswer = result.evaluation.correctAnswer;

  if (isCorrect) mcqRun.correct++;

  const feedback =
    `${isCorrect ? "✅ *Correct!*" : "❌ *Incorrect.*"}\n` +
    `Correct Answer: *${correctAnswer}*\n` +
    (result.explanation ? `\n📖 *Explanation:* ${result.explanation}` : "");

  await sendWatiSessionMessage(from, feedback);

  /* ==================== KEY FIX ==================== */
  mcqRun.index++;

  /* 👉 MORE QUESTIONS → SEND NEXT */
  if (mcqRun.index < mcqRun.total) {
    await setMCQRun(from, mcqRun);
    await sendNextMCQ(from, mcqRun);
    return;
  }

  /* 👉 FINISHED → SHOW ACTIONS */
  mcqRun.waitingForAction = true;
  await setMCQRun(from, mcqRun);

  const score = `${mcqRun.correct}/${mcqRun.total}`;

  await sendWatiSessionMessage(
    from,
    `*Quiz Completed!*\n\n📊 Your Score: *${score}*\n\nThank you for practising with us. Please select an option below to continue.`
  );

  await showActionButtons(from);
  return;
}


    /* ===================================================== */
    /* SIGNUP FLOW (only if user is in NAME step already)      */
    /* ===================================================== */

    if (!user && signup?.step === "NAME") {
      const name = rawText.trim();
      if (!name || name.length < 2) {
        await sendWatiSessionMessage(from, "❌ Please send a valid name (min 2 chars).");
        return;
      }

      user = await User.create({
        userId: uuidv4(),
        name,
        phoneNumber: phonee,
        isPhoneVerified: true,
        createdAt: new Date(),
        lastLogin: new Date(),
      });

      await delKey(SIGNUP_KEY(from));

      // New user: ask CA Level + Attempt Given before starting quiz flow
      session = { step: "ATTEMPT_GIVEN", data: { userId: user.userId, page: 0 } };
      await setJson(SESSION_KEY(from), session, 3600);

      if (await canSendStepPrompt(from, "ATTEMPT_GIVEN")) {
        await showInteractiveOptions(
          from,
          `🎉 *Welcome, ${name}!*\n\nPlease tell us your *CA Level* and *Attempt Given*:`,
          "Select",
          "CA Level & Attempt",
          ATTEMPT_GIVEN_OPTIONS,
          0
        );
      }
      return;
    }

    /* ===================================================== */
    /* MCQ START COMMAND                                       */
    /* ===================================================== */

    if (text === "mcq" || text === "/mcq") {
      if (!user) {
        // Only start signup when user explicitly types "mcq"
        await setJson(SIGNUP_KEY(from), { step: "NAME" }, 900);
        await sendWatiSessionMessage(from, "👋 Welcome! Please send your *Name* to signup.");
        return;
      }

      // Ask ATTEMPT_GIVEN only for brand-new users (no level at all)
      // OR when a previously set attempt has genuinely expired.
      // Old users who already have caLevel but no attemptGiven → use their stored level.
      const attemptExpired = user.attemptGiven && isAttemptExpired(user.attemptGiven);
      const hasNoLevelAtAll = !user.caLevel && !user.attemptGiven;

      if (hasNoLevelAtAll || attemptExpired) {
        session = { step: "ATTEMPT_GIVEN", data: { userId: user.userId, page: 0 } };
        await setJson(SESSION_KEY(from), session, 3600);
        if (await canSendStepPrompt(from, "ATTEMPT_GIVEN")) {
          await showInteractiveOptions(
            from,
            "Please tell us your *CA Level* and *Attempt Given*:",
            "Select",
            "CA Level & Attempt",
            ATTEMPT_GIVEN_OPTIONS,
            0
          );
        }
        return;
      }

      // Valid attempt or old user with caLevel — skip level selection, go directly to subjects
      const storedLevel = caLevelToShort(user.caLevel);
      if (storedLevel) {
        const subjects = await getSubjects(storedLevel);
        if (subjects && subjects.length > 0) {
          session = { step: "SUBJECT", data: { userId: user.userId, level: storedLevel, availableSubjects: subjects, page: 0 } };
          await setJson(SESSION_KEY(from), session, 3600);
          if (await canSendStepPrompt(from, "SUBJECT")) {
            await showInteractiveOptions(from, "Select Subject", "Choose Subject", "Subjects", subjects, 0);
          }
          return;
        }
      }

      // Fallback: go to level selection
      session = { step: "LEVEL", data: { userId: user.userId, page: 0 } };
      await setJson(SESSION_KEY(from), session, 3600);
      if (await canSendStepPrompt(from, "LEVEL")) {
        await showInteractiveOptions(
          from,
          "Select Your CA Level",
          "Choose Level",
          "CA Levels",
          ["Foundation", "Intermediate", "Final"],
          0
        );
      }
      return;
    }

    /* ===================================================== */
    /* CHANGE LEVEL COMMAND                                    */
    /* ===================================================== */

    if (text === "change level" || text === "/change level") {
      if (!user) {
        await sendWatiSessionMessage(from, "👋 Please type *MCQ* to get started first.");
        return;
      }
      session = { step: "ATTEMPT_GIVEN", data: { userId: user.userId, page: 0 } };
      await setJson(SESSION_KEY(from), session, 3600);
      if (await canSendStepPrompt(from, "ATTEMPT_GIVEN")) {
        await showInteractiveOptions(
          from,
          "Please select your updated *CA Level* and *Attempt Given*:",
          "Select",
          "CA Level & Attempt",
          ATTEMPT_GIVEN_OPTIONS,
          0
        );
      }
      return;
    }

    // No session active — ignore random messages from unknown users
    if (!session) {
      if (user) {
        await sendWatiSessionMessage(from, `Hello, ${user.name}!\n\nType *MCQ* to begin a practice session.\nType *Change Level* to update your CA Level and Attempt.`);
      }
      // Unknown user + no session + not "mcq" → silently ignore
      return;
    }

    /* ===================================================== */
    /* SESSION FLOW: ATTEMPT_GIVEN                            */
    /* ===================================================== */

    if (session.step === "ATTEMPT_GIVEN") {
      const currentPage = session.data.page || 0;
      const picked = pickOption(rawText, ATTEMPT_GIVEN_OPTIONS, listReplyId, currentPage, listReplyInfo);

      if (!picked) {
        if (await canSendStepPrompt(from, "ATTEMPT_GIVEN")) {
          await showInteractiveOptions(
            from,
            "Please tell us your *CA Level* and *Attempt Given*:",
            "Select",
            "CA Level & Attempt",
            ATTEMPT_GIVEN_OPTIONS,
            currentPage
          );
        }
        return;
      }

      if (picked.action === "NEXT_PAGE" || picked.action === "PREV_PAGE") {
        const newPage = picked.action === "NEXT_PAGE" ? currentPage + 1 : currentPage - 1;
        session.data.page = newPage;
        await setJson(SESSION_KEY(from), session, 3600);
        await showInteractiveOptions(
          from,
          "Please tell us your *CA Level* and *Attempt Given*:",
          "Select",
          "CA Level & Attempt",
          ATTEMPT_GIVEN_OPTIONS,
          newPage
        );
        return;
      }

      if (picked.action === "SELECT") {
        const parsed = parseAttemptOption(picked.value);
        if (!parsed) {
          await sendWatiSessionMessage(from, "❌ Invalid selection. Please try again.");
          await showInteractiveOptions(
            from,
            "Please tell us your *CA Level* and *Attempt Given*:",
            "Select",
            "CA Level & Attempt",
            ATTEMPT_GIVEN_OPTIONS,
            0
          );
          return;
        }

        // Persist caLevel + attemptGiven on the user record
        await User.findOneAndUpdate(
          { userId: user.userId },
          { caLevel: parsed.caLevel, attemptGiven: parsed.attemptGiven }
        );
        user.caLevel = parsed.caLevel;
        user.attemptGiven = parsed.attemptGiven;

        // Fetch subjects and move straight to SUBJECT step
        const subjects = await getSubjects(parsed.level);
        if (!subjects || subjects.length === 0) {
          await sendWatiSessionMessage(from, "❌ No subjects found for this level. Please try again.");
          session.data.page = 0;
          await setJson(SESSION_KEY(from), session, 3600);
          await showInteractiveOptions(
            from,
            "Please tell us your *CA Level* and *Attempt Given*:",
            "Select",
            "CA Level & Attempt",
            ATTEMPT_GIVEN_OPTIONS,
            0
          );
          return;
        }

        session.step = "SUBJECT";
        session.data.level = parsed.level;
        session.data.availableSubjects = subjects;
        session.data.page = 0;
        await setJson(SESSION_KEY(from), session, 3600);

        if (await canSendStepPrompt(from, "SUBJECT")) {
          await showInteractiveOptions(from, "Select Subject", "Choose Subject", "Subjects", subjects, 0);
        }
      }
      return;
    }

    /* ===================================================== */
    /* SESSION FLOW: LEVEL                                     */
    /* ===================================================== */

    if (session.step === "LEVEL") {
      console.log("[WEBHOOK] Processing LEVEL selection");
      const levels = ["Foundation", "Intermediate", "Final"];
      const currentPage = session.data.page || 0;
      const picked = pickOption(rawText, levels, listReplyId, currentPage, listReplyInfo);

      console.log("[WEBHOOK] Picked level:", picked);

      if (!picked) {
        console.log("[WEBHOOK] Invalid level, re-prompting");
        if (await canSendStepPrompt(from, "LEVEL")) {
          await showInteractiveOptions(
            from,
            "Select Your CA Level",
            "Choose Level",
            "CA Levels",
            levels,
            currentPage
          );
        }
        return;
      }

      // Handle pagination
      if (picked.action === "NEXT_PAGE" || picked.action === "PREV_PAGE") {
        const newPage = picked.action === "NEXT_PAGE" ? currentPage + 1 : currentPage - 1;
        session.data.page = newPage;
        await setJson(SESSION_KEY(from), session, 3600);
        
        await showInteractiveOptions(
          from,
          "Select Your CA Level",
          "Choose Level",
          "CA Levels",
          levels,
          newPage
        );
        return;
      }

      if (picked.action === "SELECT") {
        session.data.level = picked.value;
        session.step = "SUBJECT";
        session.data.page = 0; // Reset page for next step

        console.log("[WEBHOOK] Fetching subjects for level:", picked.value);

        // ✅ fetch subjects based on selected level
        const subjects = await getSubjects(picked.value);
        
        console.log("[WEBHOOK] Subjects fetched:", subjects);

        if (!subjects || subjects.length === 0) {
          session.step = "LEVEL";
          await setJson(SESSION_KEY(from), session, 3600);
          await sendWatiSessionMessage(from, "❌ No subjects found for this level. Try again.");
          if (await canSendStepPrompt(from, "LEVEL")) {
            await showInteractiveOptions(
              from,
              "Select Your CA Level",
              "Choose Level",
              "CA Levels",
              levels,
              0
            );
          }
          return;
        }

        session.data.availableSubjects = subjects;
        await setJson(SESSION_KEY(from), session, 3600);

        console.log("[WEBHOOK] Session updated, sending subject options");

        if (await canSendStepPrompt(from, "SUBJECT")) {
          await showInteractiveOptions(
            from,
            "Select Subject",
            "Choose Subject",
            "Subjects",
            subjects,
            0
          );
        }
      }
      return;
    }

    /* ===================================================== */
    /* SESSION FLOW: SUBJECT                                   */
    /* ===================================================== */

    if (session.step === "SUBJECT") {
      console.log("[WEBHOOK] Processing SUBJECT selection");
      const currentPage = session.data.page || 0;
      const picked = pickOption(rawText, session.data.availableSubjects || [], listReplyId, currentPage, listReplyInfo);
      
      console.log("[WEBHOOK] Picked subject:", picked);

      if (!picked) {
        if (await canSendStepPrompt(from, "SUBJECT")) {
          await showInteractiveOptions(
            from,
            "Select Subject",
            "Choose Subject",
            "Subjects",
            session.data.availableSubjects || [],
            currentPage
          );
        }
        return;
      }

      // Handle pagination
      if (picked.action === "NEXT_PAGE" || picked.action === "PREV_PAGE") {
        const newPage = picked.action === "NEXT_PAGE" ? currentPage + 1 : currentPage - 1;
        session.data.page = newPage;
        await setJson(SESSION_KEY(from), session, 3600);
        
        await showInteractiveOptions(
          from,
          "Select Subject",
          "Choose Subject",
          "Subjects",
          session.data.availableSubjects || [],
          newPage
        );
        return;
      }

      if (picked.action === "SELECT") {
        session.data.subject = picked.value;
        session.step = "CHAPTER";
        session.data.page = 0; // Reset page for next step

        console.log("[WEBHOOK] Fetching chapters for:", session.data.level, picked.value);

        const chapters = await getChapters(session.data.level, picked.value);
        
        console.log("[WEBHOOK] Chapters fetched:", chapters);

        if (!chapters || chapters.length === 0) {
          session.step = "SUBJECT";
          await setJson(SESSION_KEY(from), session, 3600);
          await sendWatiSessionMessage(from, "❌ No chapters found. Pick another subject.");
          if (await canSendStepPrompt(from, "SUBJECT")) {
            await showInteractiveOptions(
              from,
              "Select Subject",
              "Choose Subject",
              "Subjects",
              session.data.availableSubjects || [],
              0
            );
          }
          return;
        }

        session.data.availableChapters = chapters;
        await setJson(SESSION_KEY(from), session, 3600);

        console.log("[WEBHOOK] Session updated, sending chapter options");

        if (await canSendStepPrompt(from, "CHAPTER")) {
          await showInteractiveOptions(
            from,
            "Select Chapter",
            "Choose Chapter",
            "Chapters",
            chapters,
            0
          );
        }
      }
      return;
    }

    /* ===================================================== */
    /* SESSION FLOW: CHAPTER                                   */
    /* ===================================================== */

    if (session.step === "CHAPTER") {
      console.log("[WEBHOOK] Processing CHAPTER selection");
      const currentPage = session.data.page || 0;
      const picked = pickOption(rawText, session.data.availableChapters || [], listReplyId, currentPage, listReplyInfo);
      
      console.log("[WEBHOOK] Picked chapter:", picked);

      if (!picked) {
        if (await canSendStepPrompt(from, "CHAPTER")) {
          await showInteractiveOptions(
            from,
            "Select Chapter",
            "Choose Chapter",
            "Chapters",
            session.data.availableChapters || [],
            currentPage
          );
        }
        return;
      }

      // Handle pagination
      if (picked.action === "NEXT_PAGE" || picked.action === "PREV_PAGE") {
        const newPage = picked.action === "NEXT_PAGE" ? currentPage + 1 : currentPage - 1;
        session.data.page = newPage;
        await setJson(SESSION_KEY(from), session, 3600);
        
        await showInteractiveOptions(
          from,
          "Select Chapter",
          "Choose Chapter",
          "Chapters",
          session.data.availableChapters || [],
          newPage
        );
        return;
      }

      if (picked.action === "SELECT") {
        session.data.chapter = picked.value;
        session.step = "UNIT";
        session.data.page = 0; // Reset page for next step

        console.log("[WEBHOOK] Fetching units for chapter:", picked.value);

        const units = await getUnits(picked.value);
        
        console.log("[WEBHOOK] Units fetched:", units);

        session.data.availableUnits = units || [];
        await setJson(SESSION_KEY(from), session, 3600);

        if (!units || units.length === 0) {
          // auto skip to generate question (no unit selection needed)
          console.log("[WEBHOOK] No units found, generating first question");
          session.data.unit = "";
          session.data.difficulty = DEFAULT_DIFFICULTY;
          
          // Generate first question directly
          await generateAndStartQuiz(from, session, user, 1);
          return;
        }

        console.log("[WEBHOOK] Session updated, sending unit options");

        if (await canSendStepPrompt(from, "UNIT")) {
          await showInteractiveOptions(
            from,
            "Select Unit or Skip",
            "Choose Unit",
            "Units",
            [...units, "Skip"],
            0
          );
        }
      }
      return;
    }

    /* ===================================================== */
    /* SESSION FLOW: UNIT -> GENERATE FIRST QUESTION          */
    /* ===================================================== */

    if (session.step === "UNIT") {
      console.log("[WEBHOOK] Processing UNIT selection");
      const currentPage = session.data.page || 0;
      const allUnitOptions = [...(session.data.availableUnits || []), "Skip"];
      
      if (text === "skip") {
        session.data.unit = "";
        console.log("[WEBHOOK] Unit skipped");
      } else {
        const picked = pickOption(rawText, allUnitOptions, listReplyId, currentPage, listReplyInfo);
        console.log("[WEBHOOK] Picked unit:", picked);
        
        if (!picked) {
          if (await canSendStepPrompt(from, "UNIT")) {
            await showInteractiveOptions(
              from,
              "Select Unit or Skip",
              "Choose Unit",
              "Units",
              allUnitOptions,
              currentPage
            );
          }
          return;
        }

        // Handle pagination
        if (picked.action === "NEXT_PAGE" || picked.action === "PREV_PAGE") {
          const newPage = picked.action === "NEXT_PAGE" ? currentPage + 1 : currentPage - 1;
          session.data.page = newPage;
          await setJson(SESSION_KEY(from), session, 3600);
          
          await showInteractiveOptions(
            from,
            "Select Unit or Skip",
            "Choose Unit",
            "Units",
            allUnitOptions,
            newPage
          );
          return;
        }

        if (picked.action === "SELECT") {
          session.data.unit = picked.value === "Skip" ? "" : picked.value;
        } else {
          return;
        }
      }

      // Set default difficulty and generate first question
      session.data.difficulty = DEFAULT_DIFFICULTY;
      await generateAndStartQuiz(from, session, user, 1);
      return;
    }
  } catch (error) {
    console.error("[WEBHOOK] Error:", error);
    console.error("[WEBHOOK] Stack:", error.stack);
  }
};

exports.processInbound = processInbound;
exports.isOtherBotsQuizTrigger = isOtherBotsQuizTrigger;
exports.belongsToDripEngine = belongsToDripEngine;
exports.belongsToCaGuru = belongsToCaGuru;
exports.QUIZ_TRIGGER_WORD = QUIZ_TRIGGER_WORD;

/* ========================================================= */
/* HELPER: Generate and Start Quiz                            */
/* ========================================================= */

async function generateAndStartQuiz(from, session, user, numQuestions) {
  const required = ["level", "subject", "chapter", "difficulty"];
  const missing = required.filter((f) => !session.data[f]);
  if (missing.length > 0) {
    console.log("[WEBHOOK] Missing required fields:", missing);
    await delKey(SESSION_KEY(from));
    await sendWatiSessionMessage(from, "Your session appears to be incomplete. Please type *MCQ* to begin again.");
    return;
  }

  // Summary message
  await sendWatiSessionMessage(
    from,
    `Please wait while we prepare your question.\n\n` +
      `📘 *Level:* ${session.data.level}\n` +
      `📚 *Subject:* ${session.data.subject}\n` +
      `📖 *Chapter:* ${session.data.chapter}\n` +
      `📂 *Unit:* ${session.data.unit || "N/A"}`
  );

  const payload = {
    userId: user.userId,
    level: session.data.level,
    subject: session.data.subject,
    chapter: session.data.chapter,
    unit: session.data.unit,
    difficulty: session.data.difficulty,
    numQuestions: numQuestions
  };

  console.log("[WEBHOOK] Generating MCQs with payload:", payload);

  const mcqResp = await generateMCQsFromPython(
    payload.level,
    payload.subject,
    payload.chapter,
    payload.unit,
    payload.difficulty,
    payload.numQuestions
  );

  const { mcqs, error } = normalizePythonMcqResponse(mcqResp);

  console.log("[WEBHOOK] MCQs generated:", mcqs.length);

  if (!mcqs.length) {
    if (error) {
      console.error("[WEBHOOK] MCQ API error:", error);
    }
    await delKey(SESSION_KEY(from));
    await sendWatiSessionMessage(from, "We were unable to generate questions at this time. Please type *MCQ* to try again.");
    return;
  }

  // ✅ create mcqIds and save in DB with answers
  const mcqIds = mcqs.map(() => uuidv4());

  const context = {
    level: session.data.level,
    subject: session.data.subject,
    chapter: session.data.chapter,
    unit: session.data.unit || "",
    difficulty: session.data.difficulty,
  };

  await saveMCQGeneration(session.data.userId, context, mcqIds, mcqs);

  // Build run payload for WhatsApp
  const runMcqs = mcqs.map((q, idx) => ({
    mcqId: mcqIds[idx],
    question: q.question,
    options: q.options,
  }));

  const run = {
    userId: session.data.userId,
    context: context, // Store context for "generate more"
    mcqs: runMcqs,
    index: 0,
    correct: 0,
    total: runMcqs.length,
    waitingForAction: false,
    waitingForMoreCount: false
  };

  await setMCQRun(from, run);
  await delKey(SESSION_KEY(from)); // clear selection flow

  console.log("[WEBHOOK] Quiz starting with", mcqs.length, "question(s)");

  // Start quiz immediately
  await sendNextMCQ(from, run);
}

exports.healthCheck = (_req, res) => {
  res.status(200).json({
    status: "OK",
    message: "WATI MCQ Bot is running",
    timestamp: new Date().toISOString(),
  });
};
