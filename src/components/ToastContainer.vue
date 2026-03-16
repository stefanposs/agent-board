<script setup lang="ts">
import { useBoard } from '../composables/useBoard'

const { toasts } = useBoard()
</script>

<template>
  <div class="toast-container" aria-live="polite" aria-atomic="false" role="status">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="toast"
      :class="`toast-${toast.type}`"
      role="alert"
    >
      {{ toast.message }}
    </div>
  </div>
</template>
