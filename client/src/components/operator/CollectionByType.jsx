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
  const shown = COLUMNS.filter(([key]) => key !== 'total')
  return (
    <>
    <ul className="space-y-3 md:hidden">
      {rows.map((row) => (
        <li key={row.type} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <div className="flex items-center justify-between">
            <p className="font-extrabold text-slate-900">{VEHICLE_LABELS[row.type] || row.type}</p>
            {row.total !== undefined && <p className="text-lg font-extrabold text-emerald-600">{money(row.total)}</p>}
          </div>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
            {shown.map(([key, label]) => (
              <div key={key}><dt className="text-slate-500">{label}</dt><dd className="text-sm font-bold text-slate-900">{money(row[key])}</dd></div>
            ))}
          </dl>
        </li>
      ))}
      {totals && totals.total !== undefined && (
        <li className="flex items-center justify-between rounded-xl bg-slate-900 px-4 py-3 text-white">
          <span className="font-bold">Total</span>
          <span className="text-lg font-extrabold">{money(totals.total)}</span>
        </li>
      )}
    </ul>
    <div className="overflow-x-auto max-md:hidden">
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
          </tfoot>
        )}
      </table>
    </div>
    </>
  )
}
