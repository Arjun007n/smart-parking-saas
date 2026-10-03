// Outbound notification channels (plan, Day 25).
//
// In-app notifications are stored in the database by notificationService.
// The channels below are the places to connect real providers. Until one is
// configured it reports isConfigured() = false and nothing is sent.
//
// To add a provider, implement send() for that channel and make
// isConfigured() check its environment variables.

const notConfigured = (name) => ({
  name,
  isConfigured: () => false,
  // eslint-disable-next-line no-unused-vars
  send: async (message) => {
    throw new Error(`${name} channel is not configured`);
  },
});

const channels = {
  email: notConfigured("email"),
  sms: notConfigured("sms"),
  whatsapp: notConfigured("whatsapp"),
  push: notConfigured("push"),
};

// Sends through every configured channel. Never throws; returns what happened.
const sendExternal = async (message, names = Object.keys(channels)) => {
  const results = [];
  for (const name of names) {
    const channel = channels[name];
    if (!channel || !channel.isConfigured()) {
      results.push({ channel: name, sent: false, reason: "not configured" });
      continue;
    }
    try {
      await channel.send(message);
      results.push({ channel: name, sent: true });
    } catch (error) {
      console.error(`Notification via ${name} failed:`, error.message);
      results.push({ channel: name, sent: false, reason: error.message });
    }
  }
  return results;
};

module.exports = { channels, sendExternal };
