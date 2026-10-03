// In-process event bus. Controllers publish what happened; anything that
// wants to react (notifications today, Socket.IO broadcasting later)
// subscribes here, so controllers never depend on the transport.
//
// Every event carries companyId (and locationId when it has one) so a
// subscriber can deliver it only to that tenant's / location's users.

const { EventEmitter } = require("events");

const EVENTS = Object.freeze({
  ENTRY_CREATED: "parking:entry-created",
  EXIT_COMPLETED: "parking:exit-completed",
  OCCUPANCY_UPDATED: "parking:occupancy-updated",
  PAYMENT_RECEIVED: "payment:received",
  PAYMENT_FAILED: "payment:failed",
  NOTIFICATION_NEW: "notification:new",
});

const bus = new EventEmitter();
bus.setMaxListeners(50);

// A failing subscriber must never break the request that published the event.
const publish = (name, payload) => {
  for (const listener of bus.listeners(name)) {
    try {
      const result = listener(payload);
      if (result && typeof result.catch === "function") {
        result.catch((error) => console.error(`Event listener failed for ${name}:`, error.message));
      }
    } catch (error) {
      console.error(`Event listener failed for ${name}:`, error.message);
    }
  }
};

const subscribe = (name, listener) => {
  bus.on(name, listener);
  return () => bus.off(name, listener);
};

// Room names for a real-time transport. Location rooms keep one site's
// events away from users of other sites.
const rooms = ({ companyId, locationId }) =>
  [`company:${companyId}`, locationId ? `location:${locationId}` : null].filter(Boolean);

module.exports = { EVENTS, publish, subscribe, rooms };
