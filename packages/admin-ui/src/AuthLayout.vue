<script setup lang="ts">
defineProps<{
  title?: string;
  description?: string;
  busy?: boolean;
}>();
</script>

<template>
  <main class="auth-shell" :aria-busy="busy || undefined">
    <section class="auth-panel" :aria-labelledby="title ? 'auth-title' : undefined">
      <div class="auth-identity">
        <div class="auth-brand" aria-hidden="true">N</div>
        <span>Nexume</span>
      </div>
      <h1 v-if="title" id="auth-title">{{ title }}</h1>
      <p v-if="description">{{ description }}</p>
      <slot />
    </section>
  </main>
</template>
