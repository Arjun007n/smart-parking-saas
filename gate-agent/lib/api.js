// Talks to the Smart Parking cloud API as ONE device (its own key).
// Every call has a timeout: a dead network must never freeze the agent.

class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// The device key travels in a header on every call, so a plain http:// serverUrl is only accepted when the
// server is on this PC or on the local network (or GATE_AGENT_ALLOW_HTTP=1 is set on purpose).
const isLocalHost = (host) => {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h === "::1") return true;
  if (/^fe80:|^f[cd][0-9a-f]{2}:/.test(h)) return true; // IPv6 link-local / unique-local
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
};

// Throws a clear message when serverUrl would send the device key over plain http across the internet.
const checkServerUrl = (serverUrl, env = process.env) => {
  let url;
  try {
    url = new URL(String(serverUrl));
  } catch {
    throw new Error(`serverUrl "${serverUrl}" is not a valid web address (use https://your-site.example)`);
  }
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && (isLocalHost(url.hostname) || env.GATE_AGENT_ALLOW_HTTP === "1")) return;
  throw new Error(
    `serverUrl "${serverUrl}" is not allowed: the device key would be sent unencrypted. Use an https:// address. ` +
      "Plain http:// is only accepted for localhost or a private LAN address; set the environment variable GATE_AGENT_ALLOW_HTTP=1 to override."
  );
};

const createClient = ({ serverUrl, key, version = "gate-agent/1.0.0", timeoutMs = 8000 }) => {
  checkServerUrl(serverUrl);
  const base = serverUrl.replace(/\/+$/, "");

  const call = async (method, path, body) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/api/device${path}`, {
        method,
        headers: { "content-type": "application/json", "x-device-key": key, "x-agent-version": version },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      let json = null;
      try {
        json = await res.json();
      } catch {
        // not JSON
      }
      if (!res.ok) throw new ApiError((json && json.message) || `HTTP ${res.status}`, res.status, json);
      return json && json.data;
    } catch (error) {
      if (error.name === "AbortError") throw new ApiError("Request timed out", 0);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };

  const upload = async (path, buffer, contentType) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(timeoutMs, 20000));
    try {
      const res = await fetch(`${base}/api/device${path}`, {
        method: "POST",
        headers: { "content-type": contentType, "x-device-key": key, "x-agent-version": version },
        body: buffer,
        signal: controller.signal,
      });
      let json = null;
      try {
        json = await res.json();
      } catch {
        // not JSON
      }
      if (!res.ok) throw new ApiError((json && json.message) || `HTTP ${res.status}`, res.status, json);
      return json && json.data;
    } catch (error) {
      if (error.name === "AbortError") throw new ApiError("Upload timed out", 0);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    // `extra` is { previewUrl } for an ANPR camera whose live picture the agent serves.
    heartbeat: (extra = {}) => call("POST", "/heartbeat", extra),
    commands: () => call("GET", "/commands"),
    ack: (id, ok, error) => call("POST", `/commands/${id}/ack`, ok ? { ok: true } : { ok: false, error: String(error).slice(0, 300) }),
    event: (type, message, severity) => call("POST", "/events", { type, message, ...(severity ? { severity } : {}) }),
    plate: (detection) => call("POST", "/anpr", detection),
    rfid: (read) => call("POST", "/rfid", read),
    fastag: (read) => call("POST", "/fastag", read),
    // A CCTV picture for a CAPTURE_SNAPSHOT command: the body is the picture itself.
    snapshot: (commandId, picture, contentType) => upload(`/snapshots?commandId=${encodeURIComponent(commandId)}`, picture, contentType),
  };
};

module.exports = { createClient, ApiError, checkServerUrl, isLocalHost };
