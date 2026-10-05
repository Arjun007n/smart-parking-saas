import { money } from '../../utils/format'
import { CountUp } from '../motion'

// The colours follow the order of the tiles: entry, exit, then the ways of paying, then the total.
const TILES = [
  ['Entry Amount', (t) => t.entryAmount, 'gradient-green'],
  ['Exit Amount', (t) => t.exitAmount, 'gradient-red'],
  ['Cash', (t) => t.cash, 'gradient-blue'],
  ['Online', (t) => t.online, 'gradient-purple'],
  ['UPI', (t) => t.upi, 'gradient-upi'],
  ['Card', (t) => t.card, 'gradient-green'],
  ['FASTag', (t) => t.fastag, 'gradient-fastag'],
  ['Wallet', (t) => t.wallet, 'gradient-purple'],
  ['Total Amount', (t) => t.total, 'gradient-dark'],
]

// Nine colourful tiles with the money taken, counting up to the figure. `totals` is the collection totals.
export default function MoneyTiles({ totals }) {
  if (!totals) return null
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {TILES.map(([label, pick, gradient]) => (
        <div key={label} className={`tile-gradient sp-lift ${gradient}`}>
          <p className="tile-amount">
            ₹ <CountUp value={Number(pick(totals)) || 0} format={(n) => money(n).replace(/^₹\s?/, '')} />
          </p>
          <p className="tile-label">{label}</p>
        </div>
      ))}
    </div>
  )
}
