import test from "node:test";
import assert from "node:assert/strict";
import { apiOrigin } from "../../client/src/native/apiBase.js";

const EMU = "Mozilla/5.0 (Linux; Android 16; sdk_gphone64_x86_64 Build/BP22) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";
const PHONE = "Mozilla/5.0 (Linux; Android 10; STK-L22 Build/HUAWEISTK-L22) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";

test("api address: the emulator reaches the PC as 10.0.2.2 instead of the Wi-Fi address", () => {
  assert.equal(apiOrigin("http://192.168.1.2:5000", { native: true, userAgent: EMU }), "http://10.0.2.2:5000");
  assert.equal(apiOrigin("http://172.20.4.9:5000", { native: true, userAgent: EMU }), "http://10.0.2.2:5000");
  assert.equal(apiOrigin("http://10.1.2.3:5000", { native: true, userAgent: EMU }), "http://10.0.2.2:5000");
});

test("api address: a real phone, the website and real servers are never changed", () => {
  assert.equal(apiOrigin("http://192.168.1.2:5000", { native: true, userAgent: PHONE }), "http://192.168.1.2:5000");
  assert.equal(apiOrigin("http://192.168.1.2:5000", { native: false, userAgent: EMU }), "http://192.168.1.2:5000");
  assert.equal(apiOrigin("https://api.parking.example", { native: true, userAgent: EMU }), "https://api.parking.example");
  assert.equal(apiOrigin("http://10.0.2.2:5000", { native: true, userAgent: EMU }), "http://10.0.2.2:5000");
  assert.equal(apiOrigin(undefined, { native: true, userAgent: EMU }), "");
  assert.equal(apiOrigin("", {}), "");
});
