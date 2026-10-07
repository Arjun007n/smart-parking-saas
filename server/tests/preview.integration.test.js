// The live picture address of a gate camera. Needs MongoDB (see tests/helpers.js).
const { setup, it, api, registerCompany, assert } = require("./helpers");

setup();

const s = {};
const add = (name, body) => api("POST", "/api/hardware", { token: s.a.token, body: { locationId: s.loc._id, name, type: "ANPR_CAMERA", ...body } });
const preview = (query, token = s.a.token) => api("GET", `/api/anpr/preview?locationId=${s.loc._id}&${query}`, { token });

it("setup: a location with an entry gate and an exit gate", async () => {
  s.a = await registerCompany("prv");
  s.b = await registerCompany("prvb");
  const loc = await api("POST", "/api/locations", {
    token: s.a.token,
    body: { name: "Preview Lot", address: { line1: "MG Road" }, capacity: { car: 10 }, gates: [{ name: "Gate A", type: "ENTRY" }, { name: "Gate B", type: "EXIT" }] },
  });
  assert.equal(loc.status, 201, JSON.stringify(loc.body));
  s.loc = loc.body.data;
});

it("no camera, or a camera without a preview, gives no address", async () => {
  const none = await preview("direction=ENTRY&gate=Gate%20A");
  assert.equal(none.status, 200, JSON.stringify(none.body));
  assert.equal(none.body.data.previewUrl, null);
  assert.equal(none.body.data.hasCamera, false);

  const cam = await add("Entry cam", { direction: "ENTRY", gate: "Gate A" });
  assert.equal(cam.status, 201, JSON.stringify(cam.body));
  const without = await preview("direction=ENTRY&gate=Gate%20A");
  assert.equal(without.body.data.previewUrl, null);
  assert.equal(without.body.data.hasCamera, true, "a camera exists even without a live picture address");
});

it("the address is only accepted as an http(s) address, and is handed to the right gate only", async () => {
  const list = await api("GET", "/api/hardware?type=ANPR_CAMERA", { token: s.a.token });
  const cam = list.body.data[0];
  const bad = await api("PUT", `/api/hardware/${cam._id}`, { token: s.a.token, body: { config: { previewUrl: "javascript:alert(1)" } } });
  assert.equal(bad.status, 400, JSON.stringify(bad.body));

  const url = "http://127.0.0.1:8090/stream.mjpg?token=abc123";
  const ok = await api("PUT", `/api/hardware/${cam._id}`, { token: s.a.token, body: { config: { previewUrl: url } } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));

  const entry = await preview("direction=ENTRY&gate=Gate%20A");
  assert.equal(entry.body.data.previewUrl, url);
  assert.equal(entry.body.data.camera, "Entry cam");
  assert.equal(entry.body.data.hasCamera, true);
  const exit = await preview("direction=EXIT&gate=Gate%20B");
  assert.equal(exit.body.data.previewUrl, null, "an entry camera is not shown at the exit");
  assert.equal(exit.body.data.hasCamera, false, "and it does not count as the exit's camera");
  assert.deepEqual(exit.body.data.elsewhere, { name: "Entry cam", direction: "ENTRY", gate: "Gate A" }, "but the screen is told which camera is set up differently");
  assert.equal(entry.body.data.elsewhere, null);
  assert.equal((await preview("direction=SIDEWAYS")).status, 400);
});

it("the camera (or its agent) tells the server its live picture address with a heartbeat", async () => {
  const made = await add("Exit cam", { direction: "EXIT", gate: "Gate B" });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const key = made.body.data.deviceKey;
  const beat = (body) => api("POST", "/api/device/heartbeat", { headers: { "x-device-key": key }, body });
  assert.equal((await preview("direction=EXIT&gate=Gate%20B")).body.data.previewUrl, null);

  const url = "http://127.0.0.1:8090/stream.mjpg?token=feed";
  assert.equal((await beat({ previewUrl: url })).status, 200);
  const after = await preview("direction=EXIT&gate=Gate%20B");
  assert.equal(after.body.data.previewUrl, url);
  assert.equal(after.body.data.hasCamera, true);

  // Something that is not an http(s) address is ignored, and the old address stays.
  assert.equal((await beat({ previewUrl: "javascript:alert(1)" })).status, 200);
  assert.equal((await preview("direction=EXIT&gate=Gate%20B")).body.data.previewUrl, url);
});

it("another company cannot ask for it", async () => {
  const res = await preview("direction=ENTRY", s.b.token);
  assert.equal(res.status, 404, JSON.stringify(res.body));
});

it("the address can be removed again", async () => {
  const list = await api("GET", "/api/hardware?type=ANPR_CAMERA", { token: s.a.token });
  const cleared = await api("PUT", `/api/hardware/${list.body.data[0]._id}`, { token: s.a.token, body: { config: { previewUrl: "" } } });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.equal((await preview("direction=ENTRY&gate=Gate%20A")).body.data.previewUrl, null);
});
