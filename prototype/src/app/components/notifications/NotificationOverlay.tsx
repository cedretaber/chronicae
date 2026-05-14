import { useEffect } from 'react'
import { useSimulationStore } from '@/app/stores/simulationStore'

type Notification = {
  id: string
  message: string
  timestamp: number
}

function NotificationItem({
  notification,
  onDismiss,
}: {
  notification: Notification
  onDismiss: () => void
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 3000)
    return () => clearTimeout(timer)
  }, [notification.id, onDismiss])

  return (
    <div className="pointer-events-auto flex items-start gap-2 rounded bg-red-800 px-4 py-2 text-sm text-white shadow-lg">
      <span className="flex-1">{notification.message}</span>
      <button className="text-gray-300 hover:text-white" onClick={onDismiss}>
        &times;
      </button>
    </div>
  )
}

export function NotificationOverlay() {
  const notifications = useSimulationStore((s) => s.pendingNotifications)
  const dismissNotification = useSimulationStore((s) => s.dismissNotification)

  return (
    <div className="pointer-events-none fixed top-16 right-4 z-50 flex flex-col gap-2">
      {notifications.map((n) => (
        <NotificationItem key={n.id} notification={n} onDismiss={() => dismissNotification(n.id)} />
      ))}
    </div>
  )
}
