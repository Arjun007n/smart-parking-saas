// Small rules that decide when a gate operator needs a supervisor's permission ("Correct tickets",
// SESSION_OVERRIDE). Kept apart from the controller so they are easy to test.

// How old a ticket may be and still be re-entered by the entry operator. REENTRY_GRACE_MINUTES (default 30).
const reEntryGraceMinutes = () => {
  const value = Number(process.env.REENTRY_GRACE_MINUTES);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 30;
};

// True when the ticket is older than the grace time, so only a supervisor or admin may re-enter it.
const reEntryNeedsSupervisor = (entryTime, now = Date.now()) => {
  const started = entryTime instanceof Date ? entryTime.getTime() : Number(new Date(entryTime));
  if (!Number.isFinite(started)) return true;
  return (now - started) / 60000 > reEntryGraceMinutes();
};

// True when the edited amount is below the calculated fee (a discount, including free).
const lowersFee = (editedAmount, calculatedTotal) => Number(editedAmount) < Number(calculatedTotal) - 0.004;

module.exports = { reEntryGraceMinutes, reEntryNeedsSupervisor, lowersFee };
