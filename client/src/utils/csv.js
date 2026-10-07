// A small CSV reader for uploads: handles quoted cells, commas and line breaks inside quotes, and a
// leading byte-order mark (Excel adds one). Returns an array of rows, each an array of text cells.
export function parseCsv(text) {
  const source = String(text || '').replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        cell += '"'
        i += 1
      } else if (ch === '"') {
        quoted = false
      } else {
        cell += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1
      row.push(cell)
      cell = ''
      rows.push(row)
      row = []
    } else {
      cell += ch
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

// Turns "Holder Name", "holder_name" and "holderName" into one key, so headers need not match exactly.
const keyOf = (header) => String(header || '').toLowerCase().replace(/[^a-z0-9]/g, '')

// Rows of a CSV as objects keyed by the wanted column names. Unknown columns are ignored.
export function csvObjects(text, wanted) {
  const [header = [], ...body] = parseCsv(text)
  const index = new Map(wanted.map((name) => [keyOf(name), name]))
  const columns = header.map((h) => index.get(keyOf(h)) || null)
  return {
    missing: wanted.filter((name) => !columns.includes(name)),
    rows: body.map((cells) => {
      const out = {}
      columns.forEach((name, i) => {
        if (name) out[name] = (cells[i] || '').trim()
      })
      return out
    }),
  }
}

// Text to download: the columns, then one example row.
export const toCsv = (rows) =>
  rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(',')).join('\r\n')
