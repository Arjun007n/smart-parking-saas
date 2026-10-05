// Local-date helpers for the report tests (the app works in APP_UTC_OFFSET_MINUTES, 330 in tests).
const { localDateText, DAY } = require("../utils/time");

// { from, to }: `daysBack` days ago up to today, as YYYY-MM-DD.
const todayText = (daysBack = 0) => {
  const now = new Date();
  return { from: localDateText(new Date(now.getTime() - daysBack * DAY)), to: localDateText(now) };
};

module.exports = { todayText };
