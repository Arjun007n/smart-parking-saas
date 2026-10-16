// Rules about which users an admin may take over, switch off or demote.

// True when every location of the target user is also one of the actor's locations. A location admin may
// change the password, role or active state of a user only then; a user who also works at another location
// belongs partly to someone else, so only a company-wide admin may do those things.
const targetWithinLocations = (actorLocationIds, targetLocationIds) => {
  const own = new Set((actorLocationIds || []).map(String));
  return (targetLocationIds || []).every((id) => own.has(String(id)));
};

module.exports = { targetWithinLocations };
