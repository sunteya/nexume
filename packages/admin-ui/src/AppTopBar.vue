<script setup lang="ts">
import { ElButton, ElTooltip } from "element-plus"
import { Database, List, LogOut, Settings } from "lucide-vue-next"

export type AppMode = "server" | "desktop"
export type AppView = "sessions" | "collectors" | "settings"

defineProps<{
  mode: AppMode
  activeView: AppView
}>()

const emit = defineEmits<{
  navigate: [view: AppView]
  disconnect: []
}>()
</script>

<template>
  <header class="app-topbar">
    <div class="topbar-brand">
      <div class="brand-mark" aria-hidden="true">N</div>
      <div class="brand-copy">
        <strong>Nexume</strong>
        <span>{{ mode === "desktop" ? "Desktop" : "Server" }}</span>
      </div>
    </div>

    <nav class="app-navigation" aria-label="Primary navigation">
      <el-tooltip content="Sessions" placement="bottom" :show-after="500">
        <button
          type="button"
          class="app-navigation-item"
          :class="{ 'is-active': activeView === 'sessions' }"
          aria-label="Sessions"
          :aria-current="activeView === 'sessions' ? 'page' : undefined"
          @click="emit('navigate', 'sessions')"
        >
          <list :size="16" :stroke-width="1.8" />
          <span>Sessions</span>
        </button>
      </el-tooltip>

      <el-tooltip content="Collectors" placement="bottom" :show-after="500">
        <button
          type="button"
          class="app-navigation-item"
          :class="{ 'is-active': activeView === 'collectors' }"
          aria-label="Collectors"
          :aria-current="activeView === 'collectors' ? 'page' : undefined"
          @click="emit('navigate', 'collectors')"
        >
          <database :size="16" :stroke-width="1.8" />
          <span>Collectors</span>
        </button>
      </el-tooltip>

      <el-tooltip content="Settings" placement="bottom" :show-after="500">
        <button
          type="button"
          class="app-navigation-item"
          :class="{ 'is-active': activeView === 'settings' }"
          aria-label="Settings"
          :aria-current="activeView === 'settings' ? 'page' : undefined"
          @click="emit('navigate', 'settings')"
        >
          <settings :size="16" :stroke-width="1.8" />
          <span>Settings</span>
        </button>
      </el-tooltip>
    </nav>

    <div class="topbar-actions">
      <el-tooltip
        v-if="mode === 'server'"
        content="Sign out"
        placement="bottom"
      >
        <el-button
          class="topbar-icon-button"
          circle
          aria-label="Sign out"
          @click="emit('disconnect')"
        >
          <log-out :size="16" :stroke-width="1.8" />
        </el-button>
      </el-tooltip>
    </div>
  </header>
</template>
