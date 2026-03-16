<script setup lang="ts">
import { useNotifications } from '../composables/useNotifications'
import { useBoard } from '../composables/useBoard'
import { useFocusTrap } from '../composables/useFocusTrap'
import { ref } from 'vue'

const { notifications, unreadCount, markRead, markAllRead, dismissNotification, clearAll, showNotificationCenter } = useNotifications()
const { selectTask } = useBoard()

const panelRef = ref<HTMLElement | null>(null)
useFocusTrap(panelRef)

function handleClick(notif: typeof notifications.value[0]) {
  markRead(notif.id)
  if (notif.taskId) {
    selectTask(notif.taskId)
    showNotificationCenter.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') showNotificationCenter.value = false
}

const typeIcons: Record<string, string> = {
  'agent-waiting': '🔴',
  'decision-pending': '🔔',
  'question-pending': '❓',
  'escalation': '🆘',
  'loop-warning': '♻️',
  'info': 'ℹ️',
}

const typeColors: Record<string, string> = {
  'agent-waiting': 'var(--accent-red, #ef4444)',
  'decision-pending': 'var(--accent-yellow, #f59e0b)',
  'question-pending': 'var(--accent-blue, #3b82f6)',
  'escalation': 'var(--accent-red, #ef4444)',
  'loop-warning': 'var(--accent-orange, #f97316)',
  'info': 'var(--text-muted, #888)',
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ts).toLocaleDateString()
}
</script>

<template>
  <div
    v-if="showNotificationCenter"
    class="notification-overlay"
    @click.self="showNotificationCenter = false"
    @keydown="onKeydown"
  >
    <div class="notification-panel" ref="panelRef" role="dialog" aria-label="Notifications">
      <div class="notification-header">
        <h3 class="notification-title">🔔 Notifications</h3>
        <div class="notification-header-actions">
          <button
            v-if="unreadCount > 0"
            class="btn btn-sm"
            @click="markAllRead"
            title="Mark all as read"
          >
            ✓ All read
          </button>
          <button
            v-if="notifications.length > 0"
            class="btn btn-sm"
            @click="clearAll"
            title="Clear all"
          >
            🗑
          </button>
          <button class="notification-close" @click="showNotificationCenter = false" aria-label="Close">✕</button>
        </div>
      </div>

      <div class="notification-list" v-if="notifications.length > 0">
        <div
          v-for="notif in notifications"
          :key="notif.id"
          class="notification-item"
          :class="{ unread: !notif.read }"
          role="button"
          tabindex="0"
          @click="handleClick(notif)"
          @keydown.enter="handleClick(notif)"
        >
          <div class="notification-icon" :style="{ color: typeColors[notif.type] }">
            {{ typeIcons[notif.type] || 'ℹ️' }}
          </div>
          <div class="notification-content">
            <div class="notification-item-title">{{ notif.title }}</div>
            <div class="notification-message">{{ notif.message }}</div>
            <div class="notification-time">{{ formatTime(notif.timestamp) }}</div>
          </div>
          <button
            class="notification-dismiss"
            @click.stop="dismissNotification(notif.id)"
            title="Dismiss"
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      </div>

      <div v-else class="notification-empty">
        No notifications
      </div>
    </div>
  </div>
</template>



<style scoped>
.notification-overlay {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.3);
}

.notification-panel {
  position: absolute;
  top: 48px;
  right: 16px;
  width: 380px;
  max-height: calc(100vh - 80px);
  background: var(--bg-card, #1e1e2e);
  border: 1px solid var(--border-color, #333);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.notification-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color, #333);
}

.notification-title {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
}

.notification-header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.notification-close {
  background: none;
  border: none;
  color: var(--text-muted, #888);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 6px;
  border-radius: 4px;
}

.notification-close:hover {
  background: var(--bg-hover, rgba(255, 255, 255, 0.08));
  color: var(--text-primary, #fff);
}

.notification-list {
  overflow-y: auto;
  max-height: 400px;
  padding: 4px;
}

.notification-item {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  position: relative;
}

.notification-item:hover {
  background: var(--bg-hover, rgba(255, 255, 255, 0.06));
}

.notification-item.unread {
  background: rgba(59, 130, 246, 0.06);
  border-left: 3px solid var(--accent-blue, #3b82f6);
}

.notification-icon {
  font-size: 18px;
  flex-shrink: 0;
  width: 24px;
  text-align: center;
  padding-top: 2px;
}

.notification-content {
  flex: 1;
  min-width: 0;
}

.notification-item-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary, #fff);
  margin-bottom: 2px;
}

.notification-message {
  font-size: 11px;
  color: var(--text-secondary, #aaa);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.notification-time {
  font-size: 10px;
  color: var(--text-muted, #666);
  margin-top: 4px;
}

.notification-dismiss {
  position: absolute;
  top: 8px;
  right: 8px;
  background: none;
  border: none;
  color: var(--text-muted, #666);
  cursor: pointer;
  font-size: 11px;
  padding: 2px 4px;
  border-radius: 3px;
  opacity: 0;
  transition: opacity 0.15s;
}

.notification-item:hover .notification-dismiss {
  opacity: 1;
}

.notification-dismiss:hover {
  background: var(--bg-hover, rgba(255, 255, 255, 0.1));
  color: var(--text-primary, #fff);
}

.notification-empty {
  padding: 32px 16px;
  text-align: center;
  color: var(--text-muted, #666);
  font-size: 13px;
}
</style>
