import { Alert } from '../ui'
import { errorMessage } from '../../utils/errors'
import { money } from '../../utils/format'

// The items, discount, GST and total of a quote worked out by the server.
export default function QuoteSummary({ quote, error, loading }) {
  if (error) return <Alert>{errorMessage(error)}</Alert>
  if (!quote) return <p className="text-sm text-slate-500">{loading ? 'Working out the price…' : 'Choose what you want to see the price.'}</p>
  return (
    <div className={`space-y-3 text-sm ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
      <table className="w-full text-left">
        <thead className="text-xs text-slate-500">
          <tr><th className="py-1 pr-2 font-medium">Item</th><th className="pr-2 text-right font-medium">Qty</th><th className="pr-2 text-right font-medium">Rate</th><th className="text-right font-medium">Amount</th></tr>
        </thead>
        <tbody>
          {quote.lines.map((l) => (
            <tr key={l.key} className="border-t border-slate-100">
              <td className="py-1.5 pr-2 text-slate-800">{l.label}</td>
              <td className="pr-2 text-right">{l.qty}</td>
              <td className="pr-2 text-right">{money(l.rate)}</td>
              <td className="text-right">{money(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="space-y-1 border-t border-slate-200 pt-2">
        <div className="flex justify-between"><dt>Sub Total</dt><dd>{money(quote.subtotal)}</dd></div>
        {quote.discount > 0 && <div className="flex justify-between text-emerald-700"><dt>Discount ({quote.discountPercent}%)</dt><dd>- {money(quote.discount)}</dd></div>}
        <div className="flex justify-between"><dt>Gross Total</dt><dd>{money(quote.gross)}</dd></div>
        <div className="flex justify-between text-slate-600"><dt>CGST {quote.gstPercent / 2} %</dt><dd>{money(quote.cgst)}</dd></div>
        <div className="flex justify-between text-slate-600"><dt>SGST {quote.gstPercent / 2} %</dt><dd>{money(quote.sgst)}</dd></div>
        <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900"><dt>Total Amount</dt><dd>{money(quote.total)}</dd></div>
      </dl>
      <p className="text-xs text-slate-500">Prices are per month before GST. If you are in another state the GST is shown as IGST on the invoice.</p>
    </div>
  )
}
