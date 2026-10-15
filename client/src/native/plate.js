// Finds an Indian number plate in the lines of text the phone read from a camera picture, and decides when a reading
// can be trusted. No phone code here, so it can be tested on its own (mobile/tests/plate.test.mjs).
//
// A plate looks like  CG 11 AF 0595: state (2 letters), district (1-2 digits), series (0-3 letters), number (4 digits).
// Bike plates are often on two rows (CG 11 A / F 0595). The "BH" series looks like  22 BH 1234 AA.

export const STATES = new Set(
  'AN AP AR AS BR CH CG DD DL DN GA GJ HP HR JH JK KA KL LA LD MH ML MN MP MZ NL OD OR PB PY RJ SK TN TR TS UK UP UA WB'.split(' '),
)

// What a camera reader mixes up. In a letter place a digit shape is read as the letter, and the other way round.
const TO_LETTER = { 0: 'O', 1: 'I', 2: 'Z', 4: 'A', 5: 'S', 6: 'G', 8: 'B' }
const TO_DIGIT = { O: '0', Q: '0', D: '0', I: '1', L: '1', Z: '2', S: '5', G: '6', B: '8' }
const letter = (c) => (/[A-Z]/.test(c) ? c : TO_LETTER[c] || '')
const digit = (c) => (/\d/.test(c) ? c : TO_DIGIT[c] || '')

// Plain A-Z and 0-9 only.
export const squash = (text) => String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

// The plate written with spaces, for showing:  CG11AF0595 -> CG 11 AF 0595
export const formatPlate = (plate) => {
  const text = squash(plate)
  const bh = text.match(/^(\d{2})(BH)(\d{4})([A-Z]{1,2})$/)
  if (bh) return bh.slice(1).join(' ')
  const m = text.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{4})$/)
  return m ? m.slice(1).filter(Boolean).join(' ') : text
}

// Reads `chars` as state + district + series + number, fixing look-alike characters by place. Null if it cannot be one.
const fit = (chars, district, series) => {
  const out = []
  let at = 0
  let fixes = 0
  const take = (count, fix) => {
    for (let i = 0; i < count; i += 1) {
      const original = chars[at + i]
      const fixed = fix(original)
      if (!fixed) return false
      if (fixed !== original) fixes += 1
      out.push(fixed)
    }
    at += count
    return true
  }
  if (!take(2, letter) || !take(district, digit) || !take(series, letter) || !take(4, digit)) return null
  const text = out.join('')
  if (!STATES.has(text.slice(0, 2))) return null
  return { plate: text, fixes, district }
}

const bharat = (chars) => {
  if (chars.length < 9 || chars.length > 10) return null
  const year = chars.slice(0, 2).split('').map(digit).join('')
  const series = chars.slice(4, 8).split('').map(digit).join('')
  const tail = chars.slice(8).split('').map(letter).join('')
  if (year.length !== 2 || series.length !== 4 || tail.length < 1 || tail.length > 2 || chars.slice(2, 4) !== 'BH') return null
  return { plate: `${year}BH${series}${tail}`, fixes: 0 }
}

// The plate inside one string of letters and digits (the best match: fewest look-alike fixes, then the longest).
export const plateIn = (chars) => {
  const text = squash(chars)
  let best = null
  for (let start = 0; start < text.length; start += 1) {
    const rest = text.slice(start)
    const special = bharat(rest.slice(0, 10)) || bharat(rest.slice(0, 9))
    if (special) special.rank = special.fixes * 1.5 - special.plate.length - 2
    if (special && (!best || special.rank < best.rank)) best = special
    for (const district of [2, 1]) {
      for (const series of [3, 2, 1, 0]) {
        const length = 2 + district + series + 4
        if (rest.length < length) continue
        const found = fit(rest.slice(0, length), district, series)
        if (!found) continue
        // The longest reading with the fewest look-alike fixes; a two-digit district is preferred when it is a tie
        // (so "MH1ZAB1234" is read as MH12AB1234).
        found.rank = found.fixes * 1.5 - found.plate.length - (found.district === 2 ? 2 : 0)
        if (!best || found.rank < best.rank) best = found
      }
    }
  }
  return best
}

// The plate in the lines the reader returned: each line alone, and the lines joined (a two-row plate).
export const findPlate = (lines) => {
  const list = (Array.isArray(lines) ? lines : [lines]).map(squash).filter((line) => line.length >= 2)
  const candidates = [...list]
  // A two-row plate: two short lines one under the other.
  for (let i = 0; i + 1 < list.length; i += 1) if (list[i].length <= 7 && list[i + 1].length <= 7) candidates.push(list[i] + list[i + 1])
  let best = null
  for (const candidate of candidates) {
    const found = plateIn(candidate)
    if (found && (!best || found.rank < best.rank)) best = found
  }
  return best ? best.plate : ''
}

// Trusts a plate once the same one has been read in `need` of the last `window` pictures (one wrong reading is ignored).
export function plateWatcher({ need = 2, window = 4 } = {}) {
  let recent = []
  return {
    // The plate that is now trusted, or ''.
    add(plate) {
      recent = [...recent, plate || ''].slice(-window)
      if (!plate) return ''
      return recent.filter((p) => p === plate).length >= need ? plate : ''
    },
    reset() {
      recent = []
    },
  }
}
