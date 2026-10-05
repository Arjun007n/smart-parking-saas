// Prints the page for a narrow thermal roll (80 mm or 58 mm) instead of A4.
// The paper size rule is added only for this print and removed afterwards, so
// normal printing of other pages is not affected.
export function printThermal(widthMm = 80) {
  const style = document.createElement('style')
  style.textContent = `@page { size: ${widthMm}mm auto; margin: 3mm; }
@media print { .print-area { width: ${widthMm - 6}mm !important; padding: 0 !important; font-size: 11px !important; } }`
  document.head.appendChild(style)
  const cleanup = () => {
    style.remove()
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  window.print()
}
