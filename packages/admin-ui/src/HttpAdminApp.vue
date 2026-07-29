<script setup lang="ts">
import {
  type CollectorClient,
  type SessionClient,
} from "./client";
import { ElButton, ElInput, ElTooltip } from "element-plus";
import { Database, KeyRound, List, LogOut } from "lucide-vue-next";
import { ref, shallowRef } from "vue";

import {
  createHttpCollectorClient,
  createHttpInitializationClient,
  createHttpSessionClient,
} from "./http-client";
import CollectorApp from "./CollectorApp.vue";
import InitializationApp from "./InitializationApp.vue";
import SessionApp from "./SessionApp.vue";

const props = withDefaults(
  defineProps<{ sourceLabel?: string }>(),
  { sourceLabel: "Server" },
);

const storageKey = "nexume.accessToken";
const accessToken = ref(sessionStorage.getItem(storageKey) ?? "");
const tokenInput = ref("");
const authError = ref("");
const client = shallowRef<SessionClient>();
const collectorClient = shallowRef<CollectorClient>();
const activeView = ref<"sessions" | "collectors">("sessions");
const selectedCollectorId = ref("");
const initializationReady = ref(false);
const bootstrapReady = ref(false);

function clearAccessToken(): void {
  sessionStorage.removeItem(storageKey);
  accessToken.value = "";
  client.value = undefined;
  collectorClient.value = undefined;
  authError.value = "访问令牌无效，请重新输入。";
  selectedCollectorId.value = "";
}

const initializationClient = createHttpInitializationClient(clearAccessToken);

function disconnect(): void {
  sessionStorage.removeItem(storageKey);
  accessToken.value = "";
  client.value = undefined;
  collectorClient.value = undefined;
  authError.value = "";
  activeView.value = "sessions";
  selectedCollectorId.value = "";
}

function createClient(token: string): SessionClient {
  return createHttpSessionClient(token, clearAccessToken);
}

function createCollectorClient(token: string): CollectorClient {
  return createHttpCollectorClient(token, clearAccessToken);
}

if (accessToken.value) {
  client.value = createClient(accessToken.value);
  collectorClient.value = createCollectorClient(accessToken.value);
}

function connect(): void {
  const token = tokenInput.value.trim();
  if (!token) {
    authError.value = "请输入访问令牌。";
    return;
  }

  sessionStorage.setItem(storageKey, token);
  accessToken.value = token;
  client.value = createClient(token);
  collectorClient.value = createCollectorClient(token);
  tokenInput.value = "";
  authError.value = "";
  activeView.value = "sessions";
}

function handleInitialized(token: string): void {
  if (token) {
    sessionStorage.setItem(storageKey, token);
    accessToken.value = token;
    client.value = createClient(token);
    collectorClient.value = createCollectorClient(token);
  }
  initializationReady.value = true;
}

function viewCollectorSessions(collectorId: string): void {
  selectedCollectorId.value = collectorId;
  activeView.value = "sessions";
}

function bootstrap(): void {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const token = hash.get("accessToken");
  if (!token) {
    bootstrapReady.value = true;
    return;
  }

  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  sessionStorage.setItem(storageKey, token);
  accessToken.value = token;
  client.value = createClient(token);
  collectorClient.value = createCollectorClient(token);
  bootstrapReady.value = true;
}

bootstrap();
</script>

<template>
  <main v-if="!bootstrapReady" class="auth-shell" aria-label="正在连接 Nexume">
    <section class="auth-panel">
      <div class="auth-brand" aria-hidden="true">N</div>
      <p>正在连接 Nexume</p>
    </section>
  </main>

  <initialization-app
    v-else-if="!initializationReady"
    :client="initializationClient"
    requires-access-token
    allow-local-collector-choice
    :initial-access-token="accessToken"
    @initialized="handleInitialized"
  />

  <session-app
    v-else-if="activeView === 'sessions' && client && collectorClient"
    :client="client"
    :collector-client="collectorClient"
    :initial-collector-id="selectedCollectorId"
    :source-label="props.sourceLabel"
    @collector-change="selectedCollectorId = $event"
  >
    <template #header-actions>
      <nav class="server-view-nav" :aria-label="`${props.sourceLabel} 视图`">
        <el-tooltip content="Sessions" placement="bottom">
          <el-button
            class="server-nav-button"
            type="primary"
            :icon="List"
            aria-label="Sessions"
          >
            <span class="nav-label">Sessions</span>
          </el-button>
        </el-tooltip>
        <el-tooltip content="Collectors" placement="bottom">
          <el-button
            class="server-nav-button"
            :icon="Database"
            aria-label="Collectors"
            @click="activeView = 'collectors'"
          >
            <span class="nav-label">Collectors</span>
          </el-button>
        </el-tooltip>
      </nav>
      <el-tooltip content="退出登录" placement="bottom">
        <el-button circle aria-label="退出登录" @click="disconnect">
          <log-out :size="17" :stroke-width="1.8" />
        </el-button>
      </el-tooltip>
    </template>
  </session-app>

  <collector-app
    v-else-if="collectorClient"
    :client="collectorClient"
    @view-sessions="viewCollectorSessions"
  >
    <template #header-actions>
      <nav class="server-view-nav" :aria-label="`${props.sourceLabel} 视图`">
        <el-tooltip content="Sessions" placement="bottom">
          <el-button
            class="server-nav-button"
            :icon="List"
            aria-label="Sessions"
            @click="activeView = 'sessions'"
          >
            <span class="nav-label">Sessions</span>
          </el-button>
        </el-tooltip>
        <el-tooltip content="Collectors" placement="bottom">
          <el-button
            class="server-nav-button"
            type="primary"
            :icon="Database"
            aria-label="Collectors"
          >
            <span class="nav-label">Collectors</span>
          </el-button>
        </el-tooltip>
      </nav>
      <el-tooltip content="退出登录" placement="bottom">
        <el-button circle aria-label="退出登录" @click="disconnect">
          <log-out :size="17" :stroke-width="1.8" />
        </el-button>
      </el-tooltip>
    </template>
  </collector-app>

  <main v-else class="auth-shell">
    <section class="auth-panel" aria-labelledby="auth-title">
      <div class="auth-brand" aria-hidden="true">N</div>
      <h1 id="auth-title">Nexume</h1>
      <p>输入管理 token</p>

      <form class="auth-form" @submit.prevent="connect">
        <el-input
          v-model="tokenInput"
          type="password"
          size="large"
          placeholder="访问令牌"
          show-password
          autofocus
          aria-label="访问令牌"
        >
          <template #prefix>
            <key-round :size="17" :stroke-width="1.8" />
          </template>
        </el-input>
        <span v-if="authError" class="auth-error" role="alert">{{ authError }}</span>
        <el-button type="primary" size="large" native-type="submit">
          连接 Server
        </el-button>
      </form>
    </section>
  </main>
</template>
