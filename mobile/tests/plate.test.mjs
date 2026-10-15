import test from "node:test";
import assert from "node:assert/strict";
import { findPlate, formatPlate, plateWatcher, squash } from "../../client/src/native/plate.js";

test("plate: a clean plate is found and shown with spaces", () => {
  assert.equal(findPlate(["CG 11 AF 0595"]), "CG11AF0595");
  assert.equal(formatPlate("CG11AF0595"), "CG 11 AF 0595");
  assert.equal(formatPlate("KL47BK1478"), "KL 47 BK 1478");
  assert.equal(findPlate(["MH12AB1234"]), "MH12AB1234");
  assert.equal(formatPlate("MH1A1234"), "MH 1 A 1234");
});

test("plate: a bike plate on two rows is joined", () => {
  assert.equal(findPlate(["CG 11 A", "F 0595"]), "CG11AF0595");
  assert.equal(findPlate(["CG11A", "F0595"]), "CG11AF0595");
});

test("plate: other text around the plate is ignored", () => {
  assert.equal(findPlate(["IND", "Aluminum Bike Number", "KA 01 MN 9787", "Amazon.in"]), "KA01MN9787");
  assert.equal(findPlate(["hello world", "12345"]), "");
  assert.equal(findPlate([]), "");
  assert.equal(findPlate("XX99ZZ9999"), "", "XX is not a state");
});

test("plate: look-alike characters are fixed by their place", () => {
  assert.equal(findPlate(["KA 01 MN 97B7"]), "KA01MN9787");
  assert.equal(findPlate(["MH 1Z AB 1234"]), "MH12AB1234");
  assert.equal(findPlate(["RJ 14 AB l234"]), "RJ14AB1234");
  assert.equal(findPlate(["DL 3C AQ 0012"]), "DL3CAQ0012");
  assert.equal(findPlate(["UP80CF08I5"]), "UP80CF0815");
});

test("plate: Bharat series", () => {
  assert.equal(findPlate(["22 BH 1234 AA"]), "22BH1234AA");
  assert.equal(formatPlate("22BH1234AA"), "22 BH 1234 AA");
});

test("plate: squash keeps letters and digits only", () => {
  assert.equal(squash(" cg-11 af.0595 "), "CG11AF0595");
  assert.equal(squash(null), "");
});

test("plate watcher: trusts a plate seen twice, ignores one wrong reading", () => {
  const w = plateWatcher({ need: 2, window: 4 });
  assert.equal(w.add("CG11AF0595"), "");
  assert.equal(w.add("CG11AF0S95"), "");
  assert.equal(w.add("CG11AF0595"), "CG11AF0595");
  w.reset();
  assert.equal(w.add("CG11AF0595"), "");
  assert.equal(w.add(""), "");
  assert.equal(w.add("CG11AF0595"), "CG11AF0595");
});
