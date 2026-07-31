<script setup lang="ts">
import {
  type CollectorClient,
  type AiSettingsClient,
  type ProjectClient,
  type SessionClient,
} from "./client"
import { ElButton, ElConfigProvider, ElInput } from "element-plus"
import en from "element-plus/es/locale/lang/en"
import { KeyRound } from "lucide-vue-next"
import { ref, shallowRef } from "vue"

import {
  createHttpCollectorClient,
  createHttpAiSettingsClient,
  createHttpInitializationClient,
  createHttpProjectClient,
  createHttpSessionClient,
} from "./http-client"
import CollectorApp from "./CollectorApp.vue"
import AppTopBar, { type AppMode, type AppView } from "./AppTopBar.vue"
import AuthLayout from "./AuthLayout.vue"
import InitializationApp from "./InitializationApp.vue"
import SessionApp from "./SessionApp.vue"
import ProjectSidebar from "./ProjectSidebar.vue"
import SettingsApp from "./SettingsApp.vue"

const props = withDefaults(defineProps<{ mode?: AppMode }>(), {
  mode: "server",
})

const storageKey = "nexume.accessToken"
const accessToken = ref(sessionStorage.getItem(storageKey) ?? "")
const tokenInput = ref("")
const authError = ref("")
const client = shallowRef<SessionClient>()
const collectorClient = shallowRef<CollectorClient>()
const projectClient = shallowRef<ProjectClient>()
const aiSettingsClient = shallowRef<AiSettingsClient>()
const activeView = ref<AppView>("sessions")
const selectedCollectorId = ref("")
const selectedProjectId = ref<string>()
const selectedProjectName = ref("Unassigned")
const projectRevision = ref(0)
const initializationReady = ref(false)
const bootstrapReady = ref(false)

function clearAccessToken(): void {
  sessionStorage.removeItem(storageKey)
  accessToken.value = ""
  client.value = undefined
  collectorClient.value = undefined
  projectClient.value = undefined
  aiSettingsClient.value = undefined
  authError.value =
    "The access token is invalid. Enter a valid token to continue."
  selectedCollectorId.value = ""
}

const initializationClient = createHttpInitializationClient(clearAccessToken)

function disconnect(): void {
  sessionStorage.removeItem(storageKey)
  accessToken.value = ""
  client.value = undefined
  collectorClient.value = undefined
  projectClient.value = undefined
  aiSettingsClient.value = undefined
  authError.value = ""
  activeView.value = "sessions"
  selectedCollectorId.value = ""
}

function createClient(token: string): SessionClient {
  return createHttpSessionClient(token, clearAccessToken)
}

function createCollectorClient(token: string): CollectorClient {
  return createHttpCollectorClient(token, clearAccessToken)
}

function createProjectClient(token: string): ProjectClient {
  return createHttpProjectClient(token, clearAccessToken)
}

function createAiSettingsClient(token: string): AiSettingsClient {
  return createHttpAiSettingsClient(token, clearAccessToken)
}

if (accessToken.value) {
  client.value = createClient(accessToken.value)
  collectorClient.value = createCollectorClient(accessToken.value)
  projectClient.value = createProjectClient(accessToken.value)
  aiSettingsClient.value = createAiSettingsClient(accessToken.value)
}

function connect(): void {
  const token = tokenInput.value.trim()
  if (!token) {
    authError.value = "Enter an access token."
    return
  }

  sessionStorage.setItem(storageKey, token)
  accessToken.value = token
  client.value = createClient(token)
  collectorClient.value = createCollectorClient(token)
  projectClient.value = createProjectClient(token)
  aiSettingsClient.value = createAiSettingsClient(token)
  tokenInput.value = ""
  authError.value = ""
  activeView.value = "sessions"
}

function handleInitialized(token: string): void {
  if (token) {
    sessionStorage.setItem(storageKey, token)
    accessToken.value = token
    client.value = createClient(token)
    collectorClient.value = createCollectorClient(token)
    projectClient.value = createProjectClient(token)
    aiSettingsClient.value = createAiSettingsClient(token)
  }
  initializationReady.value = true
}

function selectProject(
  projectId: string | undefined,
  projectName: string,
): void {
  selectedProjectId.value = projectId
  selectedProjectName.value = projectName
  activeView.value = "sessions"
}

function viewCollectorSessions(collectorId: string): void {
  selectedCollectorId.value = collectorId
  activeView.value = "sessions"
}

function bootstrap(): void {
  const hash = new URLSearchParams(window.location.hash.slice(1))
  const token = hash.get("accessToken")
  if (!token) {
    bootstrapReady.value = true
    return
  }

  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}`,
  )
  sessionStorage.setItem(storageKey, token)
  accessToken.value = token
  client.value = createClient(token)
  collectorClient.value = createCollectorClient(token)
  projectClient.value = createProjectClient(token)
  aiSettingsClient.value = createAiSettingsClient(token)
  bootstrapReady.value = true
}

bootstrap()
</script>

<template>
  <el-config-provider :locale="en">
    <auth-layout
      v-if="!bootstrapReady"
      description="Connecting to Nexume..."
      busy
    />

    <initialization-app
      v-else-if="!initializationReady"
      :client="initializationClient"
      requires-access-token
      allow-local-collector-choice
      :initial-access-token="accessToken"
      @initialized="handleInitialized"
    />

    <main
      v-else-if="client && collectorClient && projectClient && aiSettingsClient"
      class="app-shell"
    >
      <app-top-bar
        :mode="props.mode"
        :active-view="activeView"
        @navigate="activeView = $event"
        @disconnect="disconnect"
      />

      <div class="app-workspace">
        <project-sidebar
          v-if="activeView !== 'settings'"
          :client="projectClient"
          :active-project-id="selectedProjectId"
          @change="projectRevision++"
          @select="selectProject"
        />
        <keep-alive>
          <session-app
            v-if="activeView === 'sessions'"
            :client="client"
            :collector-client="collectorClient"
            :initial-collector-id="selectedCollectorId"
            :project-id="selectedProjectId"
            :project-name="selectedProjectName"
            :project-revision="projectRevision"
            @collector-change="selectedCollectorId = $event"
          />
          <collector-app
            v-else-if="activeView === 'collectors'"
            :client="collectorClient"
            @view-sessions="viewCollectorSessions"
          />
          <settings-app v-else :client="aiSettingsClient" />
        </keep-alive>
      </div>
    </main>

    <auth-layout
      v-else-if="props.mode === 'desktop'"
      title="Connection lost"
      description="Restart Nexume Desktop to reconnect."
    />

    <auth-layout
      v-else
      title="Connect to Server"
      description="Enter the administrator access token."
    >
      <form class="auth-form" @submit.prevent="connect">
        <el-input
          v-model="tokenInput"
          type="password"
          size="large"
          placeholder="Access token"
          show-password
          autofocus
          aria-label="Access token"
        >
          <template #prefix>
            <key-round :size="17" :stroke-width="1.8" />
          </template>
        </el-input>
        <span v-if="authError" class="auth-error" role="alert">{{
          authError
        }}</span>
        <el-button type="primary" size="large" native-type="submit">
          Connect
        </el-button>
      </form>
    </auth-layout>
  </el-config-provider>
</template>
