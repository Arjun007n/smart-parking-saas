// Talks to the Smart Parking cloud API as ONE device (its own key).
// Every call has a timeout: a dead network must never freeze the agent.

class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const createClient = ({ serverUrl, key, version = "gate-agent/1.0.0", timeoutMs = 8000 }) => {
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

module.exports = { createClient, ApiError };
