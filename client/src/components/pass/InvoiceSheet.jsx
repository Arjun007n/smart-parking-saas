import { dateOnly, money } from '../../utils/format'

// A GST pass invoice as it is shown and printed: who it is from and to, one line for the passes, the tax split.
export default function InvoiceSheet({ invoice }) {
  const { seller = {}, billTo = {}, vehicles = [], quantity, taxPercent, taxable, tax, total } = invoice
  const price = quantity ? taxable / quantity : taxable
  return (
    <article id="pass-invoice-sheet" className="space-y-4 text-sm text-slate-800">
      <header className="text-center">
        <h3 className="text-lg font-bold uppercase">{seller.name}</h3>
        {seller.address && <p>{seller.address}</p>}
        {(seller.email || seller.phone) && <p>{[seller.email, seller.phone].filter(Boolean).join(' | ')}</p>}
        <p>GST: {seller.gstNumber}</p>
      </header>
      <div className="flex justify-between border-y border-slate-300 py-2">
        <div>
          <p>Date: {invoice.invoiceDate ? new Date(invoice.invoiceDate).toISOString().slice(0, 10) : ''}</p>
          {invoice.invoiceNumber && <p>Invoice No: {invoice.invoiceNumber}</p>}
        </div>
        <p className="text-base font-bold">TAX INVOICE</p>
      </div>
      <div>
        <p className="font-semibold">INVOICE TO</p>
        <p>{billTo.name}</p>
        {billTo.address && <p>{billTo.address}</p>}
        {billTo.mobile && <p>{billTo.mobile}</p>}
        {billTo.email && <p>{billTo.email}</p>}
        <p>GSTIN: {billTo.gstNumber}</p>
      </div>
      <table className="w-full border border-slate-300 text-left">
        <thead className="bg-slate-100">
          <tr>{['#', 'Item / Vehicles', 'Qty', 'Price', 'Taxable Amount', 'Taxes(%)', 'Tax Amount', 'Total Amount'].map((h) => <th key={h} className="border border-slate-300 p-1.5">{h}</th>)}</tr>
        </thead>
        <tbody>
          <tr>
            <td className="border border-slate-300 p-1.5">1</td>
            <td className="border border-slate-300 p-1.5">{invoice.description || 'Vehicle Parking Pass'}<br /><span className="text-xs text-slate-600">{vehicles.join(', ')}</span></td>
            <td className="border border-slate-300 p-1.5">{quantity}</td>
            <td className="border border-slate-300 p-1.5">{money(price)}</td>
            <td className="border border-slate-300 p-1.5">{money(taxable)}</td>
            <td className="border border-slate-300 p-1.5">GST @ {taxPercent} %</td>
            <td className="border border-slate-300 p-1.5">{money(tax)}</td>
            <td className="border border-slate-300 p-1.5">{money(total)}</td>
          </tr>
        </tbody>
      </table>
      <div className="flex items-end justify-between">
        <p className="italic text-slate-600">Thank you for your business!</p>
        <dl className="w-64 space-y-1">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(total)}</dd></div>
          <div className="flex justify-between"><dt>Taxes (GST @ {taxPercent} %)</dt><dd>{money(tax)}</dd></div>
          <div className="flex justify-between border-t border-slate-300 pt-1 font-bold"><dt>Total Amount</dt><dd>{money(total)}</dd></div>
        </dl>
      </div>
      <p className="text-xs text-slate-500">Pass charges include GST. {dateOnly(invoice.invoiceDate)}</p>
    </article>
  )
}
