// Opens a clean copy of a table (without its buttons, switches and "no-print" parts) in a new window and prints it.
export default function printTable(table, title) {
  if (!table) return
  const copy = table.cloneNode(true)
  copy.querySelectorAll('.print\\:hidden, .no-print').forEach((el) => el.remove())
  copy.querySelectorAll('input[type="checkbox"]').forEach((box) => box.replaceWith(document.createTextNode(box.checked ? 'Yes' : 'No')))
  copy.querySelectorAll('button').forEach((button) => button.replaceWith(document.createTextNode(button.textContent)))
  const win = window.open('', '_blank')
  if (!win) return
  const heading = String(title).replace(/[<>&]/g, '')
  win.document.write(`<!doctype html><title>${heading}</title><style>body{font:12px sans-serif;margin:16px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:4px 6px;text-align:left}a{color:inherit;text-decoration:none}</style><h2>${heading}</h2>${copy.outerHTML}`)
  win.document.close()
  win.focus()
  win.print()
}
