// Prints just the invoice sheet in its own window.
export function printInvoice(id = 'pass-invoice-sheet') {
  const sheet = document.getElementById(id)
  if (!sheet) return
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(`<!doctype html><title>Invoice</title><style>body{font:13px sans-serif;margin:24px;color:#222}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:5px 7px;text-align:left}header{text-align:center}dl{width:260px;margin-left:auto}dl div{display:flex;justify-content:space-between}</style>${sheet.outerHTML}`)
  win.document.close()
  win.focus()
  win.print()
}
