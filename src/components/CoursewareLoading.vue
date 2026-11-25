<template>
  <div class="courseware-loading-overlay courseware-loading-overlay--page" role="status" aria-live="polite">
    <div class="courseware-loading-content">
      <span class="courseware-loading-spinner" aria-hidden="true"></span>
      <strong class="courseware-loading-title courseware-loading-tip">{{ tip }}</strong>
    </div>
  </div>
</template>

<script lang="ts" setup>
defineProps<{ tip: string }>()
</script>
