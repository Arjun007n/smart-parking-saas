// Live updates from the server (Server-Sent Events), read with fetch because the
// browser's EventSource cannot send the login header.
//
// The stream only says THAT something changed (a plate was seen, a payment arrived).
// The page then reloads the data through the normal API, so permissions stay in one place.
// If the stream drops, it reconnects by itself (1 s, 2 s, 4 s ... at most 15 s) and the
// screens keep refreshing on their own timers meanwhile, so nothing depends on it.

// Splits received text into complete messages. Returns { events, rest }: `rest` is the
// unfinished tail to put in front of the next chunk.
export function parseSse(text) {
  const events = []
  const parts = text.replace(/\r\n/g, '\n').split('\n\n')
  const rest = parts.pop()
  for (const block of parts) {
    let event = 'message'
    const data = []
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue // comment / heartbeat
      const colon = line.indexOf(':')
      const field = colon === -1 ? line : line.slice(0, colon)
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
      if (field === 'event') event = value
      else if (field === 'data') data.push(value)
    }
    if (!data.length && event === 'message') continue
    let payload = {}
    try {
      payload = data.length ? JSON.parse(data.join('\n')) : {}
    } catch {
      // a message that is not JSON is ignored
    }
    events.push({ event, data: payload })
  }
  return { events, rest }
}

// status: 'connecting' | 'live' | 'offline'. Returns a function that stops everything.
export function connectLive({ url, getToken, onEvent, onStatus, fetchFn = (...args) => fetch(...args), minDelay = 1000, maxDelay = 15000 }) {
  let stopped = false
  let controller = null
  let timer = null
  let failures = 0

  const wait = () => {
    if (stopped) return
    onStatus('offline')
    const delay = Math.min(maxDelay, minDelay * 2 ** Math.min(failures, 6))
    failures += 1
    timer = setTimeout(run, delay)
  }

  async function run() {
    if (stopped) return
    const token = getToken()
    if (!token) return onStatus('offline')
    onStatus('connecting')
    controller = new AbortController()
    try {
      const res = await fetchFn(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        signal: controller.signal,
        cache: 'no-store',
      })
      // A refusal (logged out, no access) is not worth hammering the server over.
      if (res.status === 401 || res.status === 403) return onStatus('offline')
      if (!res.ok || !res.body) return wait()

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parsed = parseSse(buffer)
        buffer = parsed.rest
        for (const message of parsed.events) {
          if (message.event === 'hello') {
            failures = 0
            onStatus('live')
          } else {
            onEvent(message.event, message.data)
          }
        }
      }
      return wait()
    } catch {
      return stopped ? undefined : wait()
    }
  }

  run()
  return () => {
    stopped = true
    clearTimeout(timer)
    if (controller) controller.abort()
  }
}
