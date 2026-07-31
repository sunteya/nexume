<script setup lang="ts">
defineProps<{
  title: string;
  summary?: string;
}>();
</script>

<template>
  <header class="page-toolbar">
    <div class="page-toolbar-heading">
      <div v-if="$slots.leading" class="page-toolbar-leading">
        <slot name="leading" />
      </div>
      <h1>{{ title }}</h1>
      <span v-if="summary" class="page-toolbar-summary">{{ summary }}</span>
      <slot name="metadata" />
    </div>
    <div class="page-toolbar-actions">
      <slot name="actions" />
    </div>
  </header>
</template>
