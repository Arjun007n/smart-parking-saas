import { Alert } from '../ui'
import { PASS_STATE, lastDay } from '../../utils/format'

// Tells gate staff what a vehicle's monthly pass means right now.
// `pass` is the short summary the server sends with entry and exit answers.
export default function PassBanner({ pass, at = 'entry' }) {
  if (!pass) return null
  const who = `${pass.vehicleNumber} · ${pass.holderName} · pass ${pass.passNumber}`

  if (pass.validHere) {
    return (
      <Alert type="success">
        <strong>Pass holder.</strong> {who}. Valid until {lastDay(pass.endDate)} ({pass.daysLeft} day{pass.daysLeft === 1 ? '' : 's'} left).{' '}
        {at === 'exit' ? 'Free exit.' : 'No parking fee.'}
        {pass.daysLeft <= 7 && ' The pass ends soon. Ask the holder to renew.'}
      </Alert>
    )
  }
  if (pass.state === 'ACTIVE' && !pass.coversHere) {
    return (
      <Alert type="info">
        {who}. This pass does not work at this location, so the normal tariff applies.
      </Alert>
    )
  }
  const label = (PASS_STATE[pass.state]?.label || pass.state).toLowerCase()
  return (
    <Alert type="info">
      {who}. The pass is {label}, so the normal tariff applies.
    </Alert>
  )
}
