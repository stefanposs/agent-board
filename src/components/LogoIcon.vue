<template>
  <svg :width="size" :height="size" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg" :class="className">
    <!-- Background rounded rect with gradient -->
    <defs>
      <linearGradient id="logo-grad" x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#3b82f6" />
        <stop offset="100%" stop-color="#8b5cf6" />
      </linearGradient>
    </defs>
    <rect width="128" height="128" rx="20" fill="url(#logo-grad)" />
    <!-- 3×3 board grid -->
    <rect x="22" y="22" width="24" height="24" rx="5" fill="white" fill-opacity="0.9" />
    <rect x="52" y="22" width="24" height="24" rx="5" fill="white" fill-opacity="0.55" />
    <rect x="82" y="22" width="24" height="24" rx="5" fill="white" fill-opacity="0.75" />
    <rect x="22" y="52" width="24" height="24" rx="5" fill="white" fill-opacity="0.55" />
    <rect x="52" y="52" width="24" height="24" rx="5" fill="white" fill-opacity="1.0" />
    <rect x="82" y="52" width="24" height="24" rx="5" fill="white" fill-opacity="0.55" />
    <rect x="22" y="82" width="24" height="24" rx="5" fill="white" fill-opacity="0.75" />
    <rect x="52" y="82" width="24" height="24" rx="5" fill="white" fill-opacity="0.55" />
    <rect x="82" y="82" width="24" height="24" rx="5" fill="white" fill-opacity="0.9" />
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  size?: number | string
  className?: string
}>(), {
  size: 28,
  className: '',
})
</script>
