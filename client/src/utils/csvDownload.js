import { toCsv } from './csv'

// Saves rows (an array of arrays of cells) as a CSV file the person can open in Excel.
export function csvDownload(fileName, rows) {
  const url = URL.createObjectURL(new Blob([`\uFEFF${toCsv(rows)}`], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
