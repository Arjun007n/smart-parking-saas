import { Alert } from '../../components/ui'

// Placeholder for screens that are planned but not built yet.
export default function ComingSoon({ title }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      <Alert type="info">This screen is not built yet.</Alert>
    </div>
  )
}
