// Short sound cues for the gate staff screens (a vehicle came in, went out, something failed).
// Made with the browser's own audio, so there are no files to load. The choice is kept on this device.
const KEY = 'sp_sound'

export const soundEnabled = () => {
  try {
    return localStorage.getItem(KEY) !== 'off' // on unless switched off
  } catch {
    return true
  }
}

export const setSoundEnabled = (on) => {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // Storage blocked: the choice just is not remembered.
  }
}

// [frequency in Hz, length in seconds] pairs played one after the other.
const CUES = {
  entry: [[660, 0.09], [880, 0.14]],
  exit: [[880, 0.09], [660, 0.14]],
  success: [[784, 0.08], [1047, 0.16]],
  error: [[330, 0.16], [262, 0.22]],
}

let context = null

export function playCue(name) {
  if (!soundEnabled() || !CUES[name]) return
  try {
    const Audio = window.AudioContext || window.webkitAudioContext
    if (!Audio) return
    context = context || new Audio()
    if (context.state === 'suspended') context.resume()
    let at = context.currentTime
    for (const [frequency, length] of CUES[name]) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + length)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(at)
      oscillator.stop(at + length + 0.02)
      at += length
    }
  } catch {
    // No audio available (or not allowed yet): silence is fine.
  }
}
