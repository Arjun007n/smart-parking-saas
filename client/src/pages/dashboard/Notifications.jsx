import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { notificationApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { errorMessage } from '../../utils/errors'
import { dateTime } from '../../utils/format'
import { Alert, Badge, Button, Card, PageLoader } from '../../components/ui'

const SEVERITY = {
  critical: { tone: 'red', label: 'Urgent' },
  warning: { tone: 'red', label: 'Warning' },
  info: { tone: 'blue', label: 'Note' },
}

export default function Notifications() {
  const { company } = useAuth()
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({ queryKey: ['notifications'], queryFn: () => notificationApi.list() })
  const markRead = useMutation({
    mutationFn: notificationApi.markRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Notifications</h1>
        {company && data && data.unreadCount > 0 && (
          <Button variant="secondary" loading={markRead.isPending} onClick={() => markRead.mutate({ all: true })}>
            Mark all as read
          </Button>
        )}
      </div>

      {error && <Alert>{errorMessage(error)}</Alert>}
      {markRead.error && <Alert>{errorMessage(markRead.error)}</Alert>}

      <Card>
        {isLoading ? (
          <PageLoader />
        ) : data && data.notifications.length > 0 ? (
          <ul className="divide-y divide-slate-200">
            {data.notifications.map((n) => (
              <li key={n._id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className={`text-sm ${n.read ? 'text-slate-600' : 'font-semibold text-slate-900'}`}>
                    <Badge tone={SEVERITY[n.severity]?.tone || 'slate'}>{SEVERITY[n.severity]?.label || 'Note'}</Badge>{' '}
                    {n.title}
                    {!n.read && <span className="sr-only"> (unread)</span>}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">{n.message}</p>
                  <p className="mt-1 text-xs text-slate-500">{dateTime(n.createdAt)}</p>
                </div>
                {company && !n.read && (
                  <Button variant="secondary" onClick={() => markRead.mutate({ ids: [n._id] })}>
                    Mark as read
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          !error && <p className="text-sm text-slate-500">No notifications. Alerts about capacity, payments, shifts and your subscription appear here.</p>
        )}
      </Card>
    </div>
  )
}
