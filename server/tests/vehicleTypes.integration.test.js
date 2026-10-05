// Taxi and Tempo/SUV/Mini bus through the API: capacity, entry, full, exit, not-accepted. Needs MongoDB.
const { setup, it, api, registerCompany, assert } = require("./helpers");

setup();

const s = {};
const enter = (loc, vehicleNumber, vehicleType) =>
  api("POST", "/api/parking/entry", { token: s.a.token, body: { locationId: loc._id, vehicleNumber, vehicleType } });

it("setup: one location with taxi and tempo spaces, one with cars only", async () => {
  s.a = await registerCompany("vt");
  const make = async (name, capacity) => {
    const res = await api("POST", "/api/locations", { token: s.a.token, body: { name, address: { line1: "MG Road" }, capacity } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.data;
  };
  s.mixed = await make("Mixed", { car: 2, taxi: 1, tempo: 1, heavy: 1 });
  s.cars = await make("Cars only", { car: 2 });
  assert.equal(s.mixed.capacity.taxi, 1);
  assert.equal(s.mixed.capacity.tempo, 1);
  assert.equal(s.cars.capacity.taxi, 0, "default is zero");
  const update = await api("PUT", `/api/locations/${s.mixed._id}`, {
    token: s.a.token, body: { vehicleTypes: ["CAR", "HEAVY", "TAXI", "TEMPO"] },
  });
  assert.equal(update.status, 200, JSON.stringify(update.body));
  for (const [vehicleType, name] of [["TAXI", "Taxi"], ["TEMPO", "Tempo"]]) {
    const tariff = await api("POST", "/api/tariffs", {
      token: s.a.token, body: { locationId: s.mixed._id, name, vehicleType, additionalPerHour: 30, lostTicketFee: 300 },
    });
    assert.equal(tariff.status, 201, JSON.stringify(tariff.body));
  }
});

it("a taxi and a tempo each take their own space; a second taxi finds it full", async () => {
  const taxi = await enter(s.mixed, "RJ14TX0001", "TAXI");
  assert.equal(taxi.status, 201, JSON.stringify(taxi.body));
  assert.equal(taxi.body.data.session.vehicleType, "TAXI");
  assert.equal(taxi.body.data.availability.occupied.taxi, 1);
  const tempo = await enter(s.mixed, "RJ14TP0001", "TEMPO");
  assert.equal(tempo.status, 201, JSON.stringify(tempo.body));
  const full = await enter(s.mixed, "RJ14TX0002", "TAXI");
  assert.equal(full.status, 409, "the only taxi space is taken");
  assert.match(full.body.message, /full/i);
  const car = await enter(s.mixed, "RJ14CR0001", "CAR");
  assert.equal(car.status, 201, "cars still have room: the classes do not share spaces");

  const location = (await api("GET", `/api/locations/${s.mixed._id}`, { token: s.a.token })).body.data;
  assert.deepEqual([location.occupied.car, location.occupied.taxi, location.occupied.tempo, location.occupied.heavy], [1, 1, 1, 0]);
});

it("a class the location does not accept is refused", async () => {
  const refused = await enter(s.cars, "RJ14TX0003", "TAXI");
  assert.equal(refused.status, 400, JSON.stringify(refused.body));
  assert.equal((await api("POST", "/api/parking/entry", { token: s.a.token, body: { locationId: s.mixed._id, vehicleNumber: "RJ14ZZ0001", vehicleType: "SPACESHIP" } })).status, 400);
});

it("a taxi leaves: its space is freed and the collection report has its own row", async () => {
  const found = await api("POST", "/api/parking/exit", { token: s.a.token, body: { locationId: s.mixed._id, vehicleNumber: "RJ14TX0001" } });
  assert.equal(found.status, 200, JSON.stringify(found.body));
  if (found.body.data.paymentRequired) {
    const paid = await api("POST", "/api/payments", {
      token: s.a.token, body: { sessionId: found.body.data.session._id, method: "CASH", amount: found.body.data.session.fee.total },
    });
    assert.equal(paid.status, 201, JSON.stringify(paid.body));
  }
  const location = (await api("GET", `/api/locations/${s.mixed._id}`, { token: s.a.token })).body.data;
  assert.equal(location.occupied.taxi, 0);
  const again = await enter(s.mixed, "RJ14TX0002", "TAXI");
  assert.equal(again.status, 201, "the space is free again");

  const collection = await api("GET", `/api/operator/collection?locationId=${s.mixed._id}`, { token: s.a.token });
  assert.equal(collection.status, 200, JSON.stringify(collection.body));
  const types = collection.body.data.rows.map((r) => r.type);
  for (const type of ["CAR", "BIKE", "HEAVY", "TAXI", "TEMPO"]) assert.ok(types.includes(type), `${type} has a row`);
});
