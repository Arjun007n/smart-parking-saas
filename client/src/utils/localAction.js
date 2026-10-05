// When this screen has just done something itself (made a ticket, took a payment) it shows its own
// message, so the general "a vehicle entered" pop-up from the live stream is skipped for a moment.
let last = 0

export const markLocalAction = () => {
  last = Date.now()
}

export const justActedLocally = (withinMs = 4000) => Date.now() - last < withinMs
