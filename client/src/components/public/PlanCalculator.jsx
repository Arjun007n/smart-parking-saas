import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PRICING } from '../../data/site'
import { planLabel as label, planPrice } from '../../utils/planPrice'
import { money } from '../../utils/format'
import { CountUp } from '../motion'

export default function PlanCalculator() {
  const [users, setUsers] = useState(1)
  const [months, setMonths] = useState(12)
  const price = planPrice({ users, months })

  const field = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900'
  return (
    <div className="pub-card p-6 sm:p-8">
      <h3 className="text-xl font-extrabold text-[#0b4ea2]">Build your Parking Management plan</h3>
      <p className="mt-1 text-sm text-slate-600">Choose how many users and for how long. The longer the plan, the lower the price.</p>
      <div className="mt-5 grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <label className="block text-sm font-semibold text-[#1e3d73]">
            Number of users
            <input
              type="number"
              min="1"
              max="500"
              inputMode="numeric"
              value={users}
              onChange={(event) => setUsers(Math.min(500, Math.max(1, Number.parseInt(event.target.value, 10) || 1)))}
              className={field}
            />
          </label>
          <label className="block text-sm font-semibold text-[#1e3d73]">
            Plan length
            <select value={months} onChange={(event) => setMonths(Number(event.target.value))} className={field}>
              {PRICING.tenures.map((t) => (
                <option key={t.months} value={t.months}>
                  {label(t.months)}{t.discount ? ` (${t.discount}% off)` : ''}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-slate-500">
            {money(PRICING.parkingPerUserMonth)} per user per month before discount. Prices are before GST.
          </p>
        </div>

        <dl className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
          <div className="flex justify-between"><dt className="text-slate-600">Subtotal</dt><dd className="font-semibold">{money(price.subtotal)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-600">Discount ({price.discountPercent}%)</dt><dd className="font-semibold text-green-700">− {money(price.discount)}</dd></div>
          <div className="flex justify-between border-t border-slate-200 pt-2"><dt className="text-slate-600">Total before GST</dt><dd className="font-semibold">{money(price.gross)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-600">CGST ({PRICING.gstPercent / 2}%)</dt><dd>{money(price.cgst)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-600">SGST ({PRICING.gstPercent / 2}%)</dt><dd>{money(price.sgst)}</dd></div>
          <div className="flex items-baseline justify-between border-t border-slate-200 pt-3">
            <dt className="font-bold text-slate-900">Total to pay</dt>
            <dd className="text-2xl font-extrabold text-[#0b4ea2]"><CountUp value={price.total} format={money} /></dd>
          </div>
          <p className="text-xs text-slate-500">That is about {money(price.perMonth)} a month before GST.</p>
        </dl>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link
          to={`/register?plan=buy&users=${users}&months=${months}`}
          className="sp-press inline-block rounded-lg bg-gradient-to-r from-[#007bff] to-[#0056b3] px-6 py-3 font-semibold text-white shadow hover:brightness-110"
        >
          Register and buy this plan
        </Link>
        <Link
          to={`/contact?plan=Parking Management&users=${users}&months=${months}`}
          className="sp-press inline-block rounded-lg border border-[#007bff] px-6 py-3 font-semibold text-[#007bff] hover:bg-blue-50"
        >
          Talk to us first
        </Link>
        <Link to="/login" state={{ from: `/dashboard/billing?users=${users}&months=${months}` }} className="font-semibold text-[#007bff] hover:underline">Already registered? Log in to buy</Link>
        <Link to="/register" className="font-semibold text-[#007bff] hover:underline">or start the free trial</Link>
      </div>
    </div>
  )
}
