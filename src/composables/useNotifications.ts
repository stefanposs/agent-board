import { ref, computed } from 'vue'

export type NotificationType = 'agent-waiting' | 'decision-pending' | 'question-pending' | 'escalation' | 'loop-warning' | 'info'

export interface Notification {
  id: string
  type: NotificationType
  title: string
  message: string
  taskId?: string
  agentId?: string
  timestamp: number
  read: boolean
}

// ─── Singleton State ────────────────────────────────────────────

const notifications = ref<Notification[]>([])
const showNotificationCenter = ref(false)

function useNotifications() {
  const unreadCount = computed(() => notifications.value.filter(n => !n.read).length)

  const sortedNotifications = computed(() =>
    [...notifications.value].sort((a, b) => b.timestamp - a.timestamp),
  )

  function addNotification(opts: Omit<Notification, 'id' | 'timestamp' | 'read'>) {
    // Deduplicate: don't add if identical type+taskId+agentId exists and is unread
    const existing = notifications.value.find(
      n => n.type === opts.type && n.taskId === opts.taskId && n.agentId === opts.agentId && !n.read,
    )
    if (existing) {
      existing.message = opts.message
      existing.timestamp = Date.now()
      return existing
    }

    const notification: Notification = {
      ...opts,
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      read: false,
    }
    notifications.value.unshift(notification)

    // Cap at 100 notifications
    if (notifications.value.length > 100) {
      notifications.value = notifications.value.slice(0, 100)
    }
    return notification
  }

  function markRead(id: string) {
    const n = notifications.value.find(n => n.id === id)
    if (n) n.read = true
  }

  function markAllRead() {
    for (const n of notifications.value) {
      n.read = true
    }
  }

  function dismissNotification(id: string) {
    notifications.value = notifications.value.filter(n => n.id !== id)
  }

  function clearAll() {
    notifications.value = []
  }

  function toggleNotificationCenter() {
    showNotificationCenter.value = !showNotificationCenter.value
  }

  return {
    notifications: sortedNotifications,
    unreadCount,
    showNotificationCenter,
    addNotification,
    markRead,
    markAllRead,
    dismissNotification,
    clearAll,
    toggleNotificationCenter,
  }
}

export { useNotifications }
