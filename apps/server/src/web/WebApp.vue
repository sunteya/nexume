<script setup lang="ts">
import {
  InitializationApp,
  SessionApp,
  type SessionClient,
} from "@nexume/admin-ui";
import { ElButton, ElInput, ElTooltip } from "element-plus";
import { KeyRound, LogOut } from "lucide-vue-next";
import { ref, shallowRef } from "vue";

import {
  createHttpInitializationClient,
  createHttpSessionClient,
} from "./http-client";

const storageKey = "nexume.accessToken";
const accessToken = ref(sessionStorage.getItem(storageKey) ?? "");
const tokenInput = ref("");
const authError = ref("");
const client = shallowRef<SessionClient>();
const initializationReady = ref(false);
const initializationClient = createHttpInitializationClient();

function clearAccessToken(): void {
  sessionStorage.removeItem(storageKey);
  accessToken.value = "";
  client.value = undefined;
  authError.value = "访问令牌无效，请重新输入。";
}

function disconnect(): void {
  sessionStorage.removeItem(storageKey);
  accessToken.value = "";
  client.value = undefined;
  authError.value = "";
}

function createClient(token: string): SessionClient {
  return createHttpSessionClient(token, clearAccessToken);
}

if (accessToken.value) {
  client.value = createClient(accessToken.value);
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
  tokenInput.value = "";
  authError.value = "";
}

function handleInitialized(token: string): void {
  if (token) {
    sessionStorage.setItem(storageKey, token);
    accessToken.value = token;
    client.value = createClient(token);
  }
  initializationReady.value = true;
}
</script>

<template>
  <initialization-app
    v-if="!initializationReady"
    :client="initializationClient"
    requires-access-token
    @initialized="handleInitialized"
  />

  <session-app v-else-if="client" :client="client" source-label="Server">
    <template #header-actions>
      <el-tooltip content="断开 Server" placement="bottom">
        <el-button circle aria-label="断开 Server" @click="disconnect">
          <log-out :size="17" :stroke-width="1.8" />
        </el-button>
      </el-tooltip>
    </template>
  </session-app>

  <main v-else class="auth-shell">
    <section class="auth-panel" aria-labelledby="auth-title">
      <div class="auth-brand" aria-hidden="true">N</div>
      <h1 id="auth-title">Nexume</h1>
      <p>输入 Server 访问令牌</p>

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
