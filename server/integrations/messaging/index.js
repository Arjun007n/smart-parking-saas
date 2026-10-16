// Text messages: SMS and WhatsApp.
//
// MESSAGING_PROVIDER chooses the sender:
//   none       (default) messages are switched off; the app still works
//   simulated  nothing is sent: messages are kept in memory (and shown in the server log
//              outside tests) so the flows can be tried. Never in production.
//   twilio     Twilio (https://www.twilio.com). Needs TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN,
//              plus a sender for each channel in MESSAGING_CHANNELS:
//                sms        TWILIO_SMS_FROM (a number you own) or TWILIO_MESSAGING_SERVICE_SID
//                whatsapp   TWILIO_WHATSAPP_FROM (for example whatsapp:+14155238886 for the sandbox)
//
// MESSAGING_CHANNELS is a comma list, "sms" by default. With both ("sms,whatsapp") a message goes
// out on both channels.
// MESSAGING_DEFAULT_COUNTRY_CODE (default 91) is added to numbers written without one.
//
// A provider offers: isConfigured(), problems(), send({ channel, to, body, key }) which resolves to
// { id } or throws an error with .retryable set when trying again may help.
// The functions exported here never throw: the caller gets { sent, sentTo, failed, reason }.

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_RECIPIENTS = 10;
const MAX_BODY = 600;
const OUTBOX_LIMIT = 200;
const CHANNELS = ["sms", "whatsapp"];

const env = (key) => String(process.env[key] || "").trim();
const timeoutMs = () => Math.max(1000, Math.min(30000, Number(process.env.MESSAGING_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS));

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

// The channels switched on (known names only, no repeats). Defaults to SMS.
const channels = () => {
  const wanted = env("MESSAGING_CHANNELS").toLowerCase().split(",").map((c) => c.trim()).filter(Boolean);
  const list = [...new Set(wanted.filter((c) => CHANNELS.includes(c)))];
  return list.length ? list : wanted.length ? [] : ["sms"];
};
const unknownChannels = () =>
  env("MESSAGING_CHANNELS").toLowerCase().split(",").map((c) => c.trim()).filter((c) => c && !CHANNELS.includes(c));

// "98765 43210", "09876543210", "+91 98765-43210", "0091..." -> "+919876543210". Null if it is not a phone number.
const normalizePhone = (value) => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  let text = String(value).trim().replace(/[\s\-().]/g, "");
  if (!/^\+?\d+$/.test(text)) return null;
  const code = env("MESSAGING_DEFAULT_COUNTRY_CODE").replace(/\D/g, "") || "91";
  if (text.startsWith("00")) text = `+${text.slice(2)}`;
  else if (!text.startsWith("+")) {
    if (text.startsWith("0")) text = text.slice(1);
    // A number written without "+" that already starts with the country code and has the right length.
    text = text.length === 10 || !text.startsWith(code) ? `+${code}${text}` : `+${text}`;
  }
  return /^\+[1-9]\d{7,14}$/.test(text) ? text : null;
};
const isPhone = (value) => normalizePhone(value) !== null;

const none = {
  isConfigured: () => false,
  problems: () => [],
  send: async () => {
    throw new Error("Messages are not switched on");
  },
};

// Messages "sent" by the simulated provider, newest last. Tests and the dev log read this.
const outbox = [];
const simulated = {
  isConfigured: () => true,
  problems: () => [],
  send: async (message) => {
    outbox.push({ ...message, at: new Date() });
    if (outbox.length > OUTBOX_LIMIT) outbox.shift();
    if (process.env.NODE_ENV === "development") console.log(`[simulated ${message.channel}] to ${message.to}: ${message.body}`);
    return { id: `sim-${outbox.length}` };
  },
};

const withPrefix = (value) => (value.toLowerCase().startsWith("whatsapp:") ? value : `whatsapp:${value}`);

const twilio = {
  isConfigured: () => twilio.problems().length === 0,
  problems: () => {
    const list = [];
    if (!env("TWILIO_ACCOUNT_SID")) list.push("TWILIO_ACCOUNT_SID is required");
    if (!env("TWILIO_AUTH_TOKEN")) list.push("TWILIO_AUTH_TOKEN is required");
    const on = channels();
    if (!on.length) list.push("MESSAGING_CHANNELS must include sms or whatsapp");
    if (on.includes("sms") && !env("TWILIO_SMS_FROM") && !env("TWILIO_MESSAGING_SERVICE_SID")) {
      list.push("SMS needs TWILIO_SMS_FROM (your Twilio number) or TWILIO_MESSAGING_SERVICE_SID");
    }
    if (on.includes("whatsapp") && !env("TWILIO_WHATSAPP_FROM")) list.push("WhatsApp needs TWILIO_WHATSAPP_FROM (for example whatsapp:+14155238886)");
    return list;
  },
  send: async ({ channel, to, body }) => {
    const form = new URLSearchParams();
    if (channel === "whatsapp") {
      form.set("To", withPrefix(to));
      form.set("From", withPrefix(env("TWILIO_WHATSAPP_FROM")));
    } else {
      form.set("To", to);
      if (env("TWILIO_MESSAGING_SERVICE_SID")) form.set("MessagingServiceSid", env("TWILIO_MESSAGING_SERVICE_SID"));
      else form.set("From", env("TWILIO_SMS_FROM"));
    }
    form.set("Body", body);

    const sid = env("TWILIO_ACCOUNT_SID");
    const login = Buffer.from(`${sid}:${env("TWILIO_AUTH_TOKEN")}`).toString("base64");
    let response;
    try {
      response = await doFetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
        method: "POST",
        headers: { Authorization: `Basic ${login}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
    } catch (error) {
      const reason = error.name === "AbortError" ? "timed out" : error.message;
      throw Object.assign(new Error(`Twilio could not be reached (${reason})`), { retryable: true });
    }
    let answer = null;
    try {
      answer = await response.json();
    } catch {
      // Not JSON; the status code below still tells the story.
    }
    if (!response.ok) {
      // The provider's own explanation, never the credentials.
      const why = answer && typeof answer.message === "string" ? answer.message.slice(0, 200) : "no details";
      const code = answer && answer.code ? ` (code ${answer.code})` : "";
      throw Object.assign(new Error(`Twilio answered ${response.status}: ${why}${code}`), {
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    return { id: answer && answer.sid };
  },
};

const PROVIDERS = { none, simulated, twilio };

const providerName = () => (env("MESSAGING_PROVIDER") || "none").toLowerCase();
const isKnownProvider = (name = providerName()) => Object.prototype.hasOwnProperty.call(PROVIDERS, name);
const provider = () => PROVIDERS[providerName()] || null;
const isEnabled = () => providerName() !== "none" && Boolean(provider() && provider().isConfigured());

// Sends one text to up to MAX_RECIPIENTS numbers on every switched-on channel. Resolves to
// { sent, sentTo, failed, reason }; never throws. `sent` is true when at least one text went out.
const send = async ({ to, body, key }) => {
  if (!isEnabled()) return { sent: false, reason: "messages are not switched on" };
  const numbers = [...new Set((Array.isArray(to) ? to : [to]).map(normalizePhone).filter(Boolean))].slice(0, MAX_RECIPIENTS);
  if (!numbers.length) return { sent: false, reason: "no valid phone number" };
  if (typeof body !== "string" || !body.trim()) return { sent: false, reason: "a message needs text" };
  const text = body.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").trim().slice(0, MAX_BODY);

  const sentTo = [];
  const failed = [];
  for (const number of numbers) {
    let delivered = false;
    for (const channel of channels()) {
      let lastError;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await provider().send({ channel, to: number, body: text, key: key ? `${key}:${channel}:${number}` : undefined });
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (!error.retryable) break;
        }
      }
      if (lastError) console.error(`${channel} to ${number.slice(0, -4).replace(/\d/g, "*")}${number.slice(-4)} failed:`, lastError.message);
      else delivered = true;
    }
    (delivered ? sentTo : failed).push(number);
  }
  return { sent: sentTo.length > 0, sentTo, failed, reason: sentTo.length ? undefined : "the message service could not send" };
};

module.exports = {
  PROVIDERS, CHANNELS, MAX_RECIPIENTS, providerName, isKnownProvider, provider, isEnabled, channels, unknownChannels,
  normalizePhone, isPhone, send, outbox,
};
