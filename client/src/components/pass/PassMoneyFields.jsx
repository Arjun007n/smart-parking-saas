import { Field, Select } from '../ui'
import { PASS_UNITS } from '../../utils/pass'

const METHODS = [
  ['CASH', 'Cash'],
  ['UPI', 'UPI'],
  ['CARD', 'Card'],
  ['COMPLIMENTARY', 'Free (no charge)'],
]

// The payment inputs shared by "sell a pass" and "renew a pass".
export default function PassMoneyFields({ register, errors, locations }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
      <Select label="Money taken at" error={errors.locationId?.message} {...register('locationId')}>
        <option value="">Choose…</option>
        {locations.map((l) => (
          <option key={l._id} value={l._id}>{l.name}</option>
        ))}
      </Select>
      <Field
        label="Lasts for"
        type="number"
        min="1"
        max="366"
        error={errors.count?.message}
        {...register('count', { valueAsNumber: true })}
      />
      <Select label="Unit" error={errors.unit?.message} {...register('unit')}>
        {PASS_UNITS.map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </Select>
      <Field
        label="Amount paid (₹)"
        type="number"
        min="0"
        step="0.01"
        hint="Tax included. Use 0 for a free pass."
        error={errors.amount?.message}
        {...register('amount', { valueAsNumber: true })}
      />
      <Select label="Paid by" error={errors.method?.message} {...register('method')}>
        {METHODS.map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </Select>
      <Field label="Reference (optional)" error={errors.transactionId?.message} {...register('transactionId')} />
    </div>
  )
}
