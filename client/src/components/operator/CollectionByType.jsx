import { VEHICLE_LABELS, money } from '../../utils/format'

const ALL_COLUMNS = [
  ['entryAmount', 'Entry amount'],
  ['exitAmount', 'Exit amount'],
  ['cash', 'Cash'],
  ['online', 'Online'],
  ['upi', 'UPI'],
  ['card', 'Card'],
  ['fastag', 'FASTag'],
  ['wallet', 'Wallet'],
  ['total', 'Total'],
]

// Money of a day, one row per vehicle type. Entry amount is what was taken as an
// advance at the gate; exit amount is what was paid when leaving.
export default function CollectionByType({ rows, totals }) {
  if (!rows) return null
  // A column the admin switched off for this person is missing from the figures, so it is left out.
  const sample = totals || rows[0] || {}
  const COLUMNS = ALL_COLUMNS.filter(([key]) => sample[key] !== undefined)
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="text-slate-500">
          <tr>
            <th className="pb-2 pr-3 font-medium">SNo</th>
            <th className="pb-2 pr-3 font-medium">Vehicle type</th>
            {COLUMNS.map(([key, label]) => (
              <th key={key} className="pb-2 pr-3 text-right font-medium">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.type} className="border-t border-slate-200">
              <td className="py-2 pr-3">{index + 1}</td>
              <td className="py-2 pr-3 font-medium text-slate-900">{VEHICLE_LABELS[row.type] || row.type}</td>
              {COLUMNS.map(([key]) => (
                <td key={key} className={`py-2 pr-3 text-right ${key === 'total' ? 'font-semibold' : ''}`}>{money(row[key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr className="border-t-2 border-slate-300 font-bold text-slate-900">
              <td className="py-2 pr-3" colSpan={2}>Total</td>
              {COLUMNS.map(([key]) => (
                <td key={key} className="py-2 pr-3 text-right">{money(totals[key])}</td>
              ))}
            </tr>
            {totals.refunded > 0 && (
              <tr className="text-slate-600">
                <td className="py-1 pr-3" colSpan={2}>Given back (refunds)</td>
                <td className="py-1 pr-3 text-right" colSpan={COLUMNS.length}>− {money(totals.refunded)} · net {money(totals.net)}</td>
              </tr>
            )}
          </tfoot>
        )}
      </table>
    </div>
  )
}
