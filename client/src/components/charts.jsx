import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

// Chart colours, used in this fixed order. Checked for colour-blind
// separation; a colour always belongs to the same series.
const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100']

const AXIS = { fontSize: 12, fill: '#64748b' }

// A bar chart with a "show as table" alternative, so the numbers are never
// available by colour or shape alone.
//   series: [{ key, label }]   xKey: field for the x axis
export function BarChartCard({ data, xKey, xLabel, series, height = 260, formatValue = (v) => v, summary }) {
  const empty = data.every((row) => series.every((s) => !row[s.key]))
  if (empty) return <p className="py-10 text-center text-sm text-slate-500">Nothing to show for this period yet.</p>

  return (
    <div>
      <div role="img" aria-label={summary} style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="20%" barGap={2}>
            <CartesianGrid vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} minTickGap={12} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={48} tickFormatter={formatValue} />
            <Tooltip
              cursor={{ fill: '#f1f5f9' }}
              formatter={(value, name) => [formatValue(value), name]}
              contentStyle={{ borderRadius: 8, borderColor: '#e2e8f0', fontSize: 13 }}
              labelStyle={{ color: '#0f172a', fontWeight: 600 }}
              itemStyle={{ color: '#334155' }}
            />
            {series.length > 1 && (
              <Legend
                verticalAlign="top"
                align="right"
                iconType="square"
                iconSize={10}
                formatter={(value) => <span style={{ color: '#334155', fontSize: 13 }}>{value}</span>}
              />
            )}
            {series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={SERIES_COLORS[i]} radius={[4, 4, 0, 0]} maxBarSize={28} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-blue-700">Show as table</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-left">
            <thead className="text-slate-500">
              <tr>
                <th className="pb-1 pr-4 font-medium">{xLabel}</th>
                {series.map((s) => (
                  <th key={s.key} className="pb-1 pr-4 text-right font-medium">{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row[xKey]} className="border-t border-slate-200">
                  <td className="py-1 pr-4">{row[xKey]}</td>
                  {series.map((s) => (
                    <td key={s.key} className="py-1 pr-4 text-right">{formatValue(row[s.key] || 0)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
