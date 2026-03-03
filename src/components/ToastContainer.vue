<script setup lang="ts">
import { useBoard } from '../composables/useBoard'

const { toasts } = useBoard()
</script>

<template>
  <div class="toast-container">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="toast"
      :class="`toast-${toast.type}`"
    >
      {{ toast.message }}
    </div>
  </div>
</template>
