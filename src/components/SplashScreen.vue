<script setup lang="ts">
import { ref } from 'vue'
import { useBoard } from '../composables/useBoard'
import { useExtension } from '../composables/useExtension'
import { useFocusTrap } from '../composables/useFocusTrap'
import LogoIcon from './LogoIcon.vue'

const { dismissSplash, boardType } = useBoard()
const ext = useExtension()
const dontShowAgain = ref(false)
const overlayRef = ref<HTMLElement | null>(null)
const selectedPreset = ref(boardType.value || 'software-engineering')
useFocusTrap(overlayRef)

const presets = [
  { id: 'software-engineering', label: 'Software Engineering', icon: '💻', description: 'Idea → Planning → Implementation → Review → Merged' },
  { id: 'task-board', label: 'Task Board', icon: '📋', description: 'To Do → In Progress → Done' },
]

function close() {
  if (dontShowAgain.value && ext.isWebview.value) {
    ext.dismissSplash()
  }
  // Apply selected board type if changed
  if (ext.isWebview.value && selectedPreset.value !== boardType.value) {
    ext.setBoardType(selectedPreset.value)
  }
  dismissSplash()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}
</script>

<template>
  <div class="splash-overlay" ref="overlayRef" @click.self="close" tabindex="0" role="dialog" aria-modal="true" aria-labelledby="splash-title">
    <div class="splash-card">
      <button class="splash-close" @click="close" title="Close" aria-label="Close">&times;</button>

      <LogoIcon :size="56" class="splash-logo" />
      <h1 id="splash-title" class="splash-title">Agent Board</h1>
      <p class="splash-subtitle">Personal Kanban &amp; Task Manager</p>

      <div class="splash-features">
        <div class="splash-feature">
          <span class="feature-icon">📋</span>
          <div>
            <strong>Kanban Board</strong>
            <p>Drag &amp; drop tasks through your workflow pipeline</p>
          </div>
        </div>
        <div class="splash-feature">
          <span class="feature-icon">🎯</span>
          <div>
            <strong>Goals</strong>
            <p>Link tasks to goals, track progress</p>
          </div>
        </div>
        <div class="splash-feature">
          <span class="feature-icon">🔄</span>
          <div>
            <strong>Workflow Engine</strong>
            <p>Customizable stages, transitions, and approval gates</p>
          </div>
        </div>
        <div class="splash-feature">
          <span class="feature-icon">🤖</span>
          <div>
            <strong>AI Agents</strong>
            <p>Planner, Developer, Reviewer — automated workflows</p>
          </div>
        </div>
        <div class="splash-feature">
          <span class="feature-icon">📊</span>
          <div>
            <strong>Reporting</strong>
            <p>Generate status reports for reviews &amp; retros</p>
          </div>
        </div>
        <div class="splash-feature">
          <span class="feature-icon">🔗</span>
          <div>
            <strong>External Links</strong>
            <p>Connect to Jira, Confluence, and other tools</p>
          </div>
        </div>
      </div>

      <div class="splash-board-type">
        <h3 class="splash-section-title">Choose Board Type</h3>
        <div class="preset-cards">
          <button
            v-for="preset in presets"
            :key="preset.id"
            class="preset-card"
            :class="{ selected: selectedPreset === preset.id }"
            @click="selectedPreset = preset.id"
          >
            <span class="preset-icon">{{ preset.icon }}</span>
            <strong>{{ preset.label }}</strong>
            <p>{{ preset.description }}</p>
          </button>
        </div>
      </div>

      <label class="splash-checkbox">
        <input type="checkbox" v-model="dontShowAgain" />
        Don't show this again
      </label>

      <button class="btn btn-primary splash-cta" @click="close">
        Get Started
      </button>
    </div>
  </div>
</template>

<style scoped>
.splash-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.splash-card {
  position: relative;
  background: var(--bg-secondary, #1e1e2e);
  border: 1px solid var(--border, #333);
  border-radius: 16px;
  padding: 40px;
  max-width: 520px;
  width: 90%;
  text-align: center;
  animation: slideUp 0.3s ease;
}

@keyframes slideUp {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.splash-close {
  position: absolute;
  top: 12px;
  right: 16px;
  background: none;
  border: none;
  color: var(--text-secondary, #999);
  font-size: 24px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}
.splash-close:hover {
  color: var(--text-primary, #fff);
  background: var(--bg-tertiary, #333);
}

.splash-logo {
  margin-bottom: 12px;
}

.splash-title {
  font-size: 28px;
  font-weight: 700;
  color: var(--text-primary, #fff);
  margin: 0 0 4px;
}

.splash-subtitle {
  font-size: 14px;
  color: var(--text-secondary, #999);
  margin: 0 0 28px;
}

.splash-features {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  text-align: left;
  margin-bottom: 24px;
}

.splash-feature {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.feature-icon {
  font-size: 20px;
  flex-shrink: 0;
  margin-top: 2px;
}

.splash-feature strong {
  font-size: 13px;
  color: var(--text-primary, #fff);
  display: block;
  margin-bottom: 2px;
}

.splash-feature p {
  font-size: 11px;
  color: var(--text-secondary, #999);
  margin: 0;
  line-height: 1.3;
}

.splash-checkbox {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary, #999);
  margin-bottom: 16px;
  cursor: pointer;
}

.splash-checkbox input {
  accent-color: var(--accent-blue, #3b82f6);
}

.splash-cta {
  width: 100%;
  padding: 10px 24px;
  font-size: 14px;
  font-weight: 600;
}

.splash-board-type {
  margin-bottom: 20px;
}

.splash-section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary, #999);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0 0 10px;
}

.preset-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.preset-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 14px 10px;
  border: 2px solid var(--border, #333);
  border-radius: 10px;
  background: var(--bg-primary, #181825);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  text-align: center;
}

.preset-card:hover {
  border-color: var(--accent-blue, #3b82f6);
  background: rgba(59, 130, 246, 0.05);
}

.preset-card.selected {
  border-color: var(--accent-blue, #3b82f6);
  background: rgba(59, 130, 246, 0.1);
}

.preset-icon {
  font-size: 24px;
}

.preset-card strong {
  font-size: 13px;
  color: var(--text-primary, #fff);
}

.preset-card p {
  font-size: 10px;
  color: var(--text-secondary, #999);
  margin: 0;
  line-height: 1.3;
}
</style>
