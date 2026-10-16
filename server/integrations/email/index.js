// Sending email (plan, day 27).
//
// EMAIL_PROVIDER chooses the sender:
//   none       (default) email is switched off; the app still works, alerts stay in the app
//   simulated  nothing is sent: messages are kept in memory (and shown in the server log
//              outside tests) so the screens and flows can be tried. Never in production.
//   resend     Resend (https://resend.com). Needs RESEND_API_KEY and EMAIL_FROM.
//
// EMAIL_FROM must be an address on a domain verified at the provider, for example
//   Smart Parking <alerts@yourdomain.com>
// (while testing with Resend you may use "onboarding@resend.dev", which only delivers
// to the address of your own Resend account).
//
// A provider offers: isConfigured(), problems() and send({ to, subject, text, html }),
// which resolves to { id } or throws an error with .retryable set when trying again may help.
// The functions exported here never throw: the caller gets { sent, id } or { sent: false, reason }.
// Adding another provider means adding one entry to PROVIDERS.

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_RECIPIENTS = 20;
const OUTBOX_LIMIT = 200;

const env = (key) => String(process.env[key] || "").trim();
const timeoutMs = () => Math.max(1000, Math.min(30000, Number(process.env.EMAIL_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS));

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const isEmail = (value) => typeof value === "string" && value.length <= 254 && EMAIL.test(value);

// Looked up at call time so tests can replace fetch.
const doFetch = async (url, options) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    return await globalThis.fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const none = {
  isConfigured: () => false,
  problems: () => [],
  send: async () => {
    throw new Error("Email is not switched on");
  },
};

// Messages "sent" by the simulated provider, newest last. Tests and the dev log read this.
const outbox = [];
const simulated = {
  isConfigured: () => true,
  problems: () => [],
  send: async (message) => {
    const { attachments, ...rest } = message;
    outbox.push({ ...rest, ...(attachments && attachments.length ? { attachments: attachments.map((a) => ({ filename: a.filename, bytes: Buffer.from(a.content).length })) } : {}), at: new Date() });
    if (outbox.length > OUTBOX_LIMIT) outbox.shift();
    if (process.env.NODE_ENV === "development") console.log(`[simulated email] to ${message.to.join(", ")}: ${message.subject}\n${message.text}`);
    return { id: `sim-${outbox.length}` };
  },
};

const resend = {
  isConfigured: () => Boolean(env("RESEND_API_KEY") && env("EMAIL_FROM")),
  problems: () => [
    ...(env("RESEND_API_KEY") ? [] : ["RESEND_API_KEY is required"]),
    ...(env("EMAIL_FROM") ? [] : ["EMAIL_FROM is required (an address on a domain you verified at Resend)"]),
  ],
  send: async ({ to, subject, text, html, key, attachments }) => {
    let response;
    try {
      response = await doFetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env("RESEND_API_KEY")}`,
          "Content-Type": "application/json",
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        body: JSON.stringify({
          from: env("EMAIL_FROM"), to, subject, text, html,
          ...(attachments && attachments.length
            ? { attachments: attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString("base64") })) }
            : {}),
          ...(env("EMAIL_REPLY_TO") ? { reply_to: env("EMAIL_REPLY_TO") } : {}),
        }),
      });
    } catch (error) {
      const reason = error.name === "AbortError" ? "timed out" : error.message;
      throw Object.assign(new Error(`Resend could not be reached (${reason})`), { retryable: true });
    }
    let answer = null;
    try {
      answer = await response.json();
    } catch {
      // Not JSON; the status code below still tells the story.
    }
    if (!response.ok) {
      // The provider's own explanation, never the key. 429 and 5xx are worth one more try.
      const why = answer && typeof answer.message === "string" ? answer.message.slice(0, 200) : "no details";
      throw Object.assign(new Error(`Resend answered ${response.status}: ${why}`), {
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    return { id: answer && answer.id };
  },
};

const PROVIDERS = { none, simulated, resend };

const providerName = () => (env("EMAIL_PROVIDER") || "none").toLowerCase();
const isKnownProvider = (name = providerName()) => Object.prototype.hasOwnProperty.call(PROVIDERS, name);
const provider = () => PROVIDERS[providerName()] || null;
const isEnabled = () => providerName() !== "none" && Boolean(provider() && provider().isConfigured());

// Sends one message to up to MAX_RECIPIENTS addresses (they do not see each other:
// each address gets its own copy). Resolves to { sent, sentTo, failed, reason }; never throws.
const send = async ({ to, subject, text, html, key, attachments }) => {
  if (!isEnabled()) return { sent: false, reason: "email is not switched on" };
  const addresses = [...new Set((Array.isArray(to) ? to : [to]).filter(isEmail).map((a) => a.toLowerCase()))].slice(0, MAX_RECIPIENTS);
  if (!addresses.length) return { sent: false, reason: "no valid recipient" };
  if (typeof subject !== "string" || !subject.trim() || typeof text !== "string" || !text.trim()) {
    return { sent: false, reason: "a message needs a subject and text" };
  }
  // Header injection guard: a subject is one line.
  const cleanSubject = subject.replace(/[\r\n]+/g, " ").trim().slice(0, 200);

  const sentTo = [];
  const failed = [];
  for (const address of addresses) {
    const message = { to: [address], subject: cleanSubject, text, html, key: key ? `${key}:${address}` : undefined, ...(attachments && attachments.length ? { attachments } : {}) };
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await provider().send(message);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (!error.retryable) break;
      }
    }
    if (lastError) {
      // Details go to the server log (never the key, never the message body).
      console.error(`Email to ${address} failed:`, lastError.message);
      failed.push(address);
    } else {
      sentTo.push(address);
    }
  }
  return { sent: sentTo.length > 0, sentTo, failed, reason: sentTo.length ? undefined : "the email service could not send" };
};

module.exports = { PROVIDERS, MAX_RECIPIENTS, providerName, isKnownProvider, provider, isEnabled, isEmail, send, outbox };
