<script setup lang="ts">
import {
  type CollectorClient,
  type AiSettingsClient,
  type ProjectClient,
  type SessionClient,
} from "./client"
import {
  ElButton,
  ElConfigProvider,
  ElInput,
  ElMessage,
  ElOption,
  ElSelect,
} from "element-plus"
import en from "element-plus/es/locale/lang/en"
import { KeyRound, Search } from "lucide-vue-next"
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue"

import type { ManagedCollectorInfo } from "@nexume/contracts"

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
const collectors = ref<ManagedCollectorInfo[]>([])
const collectorsLoading = ref(false)
const selectedCollectorId = ref("")
const selectedAgent = ref("")
const selectedProjectId = ref<string>()
const selectedProjectName = ref("Unassigned")
const projectRevision = ref(0)
const sessionRevision = ref(0)
const sessionSearchInput = ref("")
const sessionTitleQuery = ref("")
const initializationReady = ref(false)
const bootstrapReady = ref(false)
let sessionSearchTimer: ReturnType<typeof setTimeout> | undefined
let collectorRequest = 0

const agentOptions = computed(() => {
  const availableCollectors = selectedCollectorId.value
    ? collectors.value.filter(
        (collector) => collector.id === selectedCollectorId.value,
      )
    : collectors.value
  return [
    ...new Set(availableCollectors.flatMap((collector) => collector.agents)),
  ].sort((left, right) => left.localeCompare(right, "en"))
})

function resetSessionFilters(): void {
  if (sessionSearchTimer !== undefined) clearTimeout(sessionSearchTimer)
  sessionSearchTimer = undefined
  sessionSearchInput.value = ""
  sessionTitleQuery.value = ""
  selectedCollectorId.value = ""
  selectedAgent.value = ""
}

function clearAccessToken(): void {
  sessionStorage.removeItem(storageKey)
  accessToken.value = ""
  client.value = undefined
  collectorClient.value = undefined
  projectClient.value = undefined
  aiSettingsClient.value = undefined
  authError.value =
    "The access token is invalid. Enter a valid token to continue."
  resetSessionFilters()
}

const initializationClient = createHttpInitializationClient(clearAccessToken)

function applySessionSearch(): void {
  if (sessionSearchTimer !== undefined) clearTimeout(sessionSearchTimer)
  sessionSearchTimer = undefined
  sessionTitleQuery.value = sessionSearchInput.value.trim()
}

function handleSessionSearchInput(): void {
  if (sessionSearchTimer !== undefined) clearTimeout(sessionSearchTimer)
  sessionSearchTimer = setTimeout(applySessionSearch, 300)
}

function normalizeSessionFilters(): void {
  if (
    selectedCollectorId.value &&
    !collectors.value.some(
      (collector) => collector.id === selectedCollectorId.value,
    )
  ) {
    selectedCollectorId.value = ""
  }
  if (selectedAgent.value && !agentOptions.value.includes(selectedAgent.value)) {
    selectedAgent.value = ""
  }
}

async function loadSessionFilterOptions(): Promise<void> {
  const current = collectorClient.value
  if (!current || !initializationReady.value) return
  const requestId = ++collectorRequest
  collectorsLoading.value = true
  try {
    const items = await current.list()
    if (
      requestId !== collectorRequest ||
      current !== collectorClient.value
    ) {
      return
    }
    collectors.value = items
    normalizeSessionFilters()
  } catch (error) {
    if (requestId !== collectorRequest) return
    ElMessage.error(
      error instanceof Error ? error.message : "Unable to load collectors.",
    )
  } finally {
    if (requestId === collectorRequest) collectorsLoading.value = false
  }
}

function handleCollectorFilterChange(): void {
  selectedAgent.value = ""
}

function handleSessionsRefreshed(): void {
  sessionRevision.value += 1
  void loadSessionFilterOptions()
}

function disconnect(): void {
  sessionStorage.removeItem(storageKey)
  accessToken.value = ""
  client.value = undefined
  collectorClient.value = undefined
  projectClient.value = undefined
  aiSettingsClient.value = undefined
  authError.value = ""
  activeView.value = "sessions"
  resetSessionFilters()
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
  selectedAgent.value = ""
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

watch(
  [collectorClient, initializationReady],
  ([current, ready], _previous, onCleanup) => {
    if (!current || !ready) return
    void loadSessionFilterOptions()
    const unsubscribe = current.subscribe((items) => {
      if (current !== collectorClient.value) return
      collectors.value = items
      normalizeSessionFilters()
    })
    onCleanup(unsubscribe)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (sessionSearchTimer !== undefined) clearTimeout(sessionSearchTimer)
})
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

      <section
        v-if="activeView === 'sessions'"
        class="global-session-filters"
        aria-label="Global session filters"
      >
        <el-input
          v-model="sessionSearchInput"
          class="global-session-search"
          :prefix-icon="Search"
          placeholder="Search session titles"
          maxlength="256"
          clearable
          aria-label="Filter all sessions by title"
          @input="handleSessionSearchInput"
          @clear="applySessionSearch"
          @keyup.enter="applySessionSearch"
        />
        <label class="global-session-filter-field">
          <span>Collector</span>
          <el-select
            v-model="selectedCollectorId"
            class="global-session-select"
            :loading="collectorsLoading"
            placeholder="All collectors"
            aria-label="Filter all sessions by collector"
            @change="handleCollectorFilterChange"
          >
            <el-option label="All collectors" value="" />
            <el-option
              v-for="collector in collectors"
              :key="collector.id"
              :label="collector.name"
              :value="collector.id"
            />
          </el-select>
        </label>
        <label class="global-session-filter-field">
          <span>Agent</span>
          <el-select
            v-model="selectedAgent"
            class="global-session-select"
            placeholder="All agents"
            aria-label="Filter all sessions by agent"
          >
            <el-option label="All agents" value="" />
            <el-option
              v-for="agent in agentOptions"
              :key="agent"
              :label="agent"
              :value="agent"
            />
          </el-select>
        </label>
      </section>

      <div class="app-workspace">
        <project-sidebar
          v-if="activeView !== 'settings'"
          :client="projectClient"
          :active-project-id="selectedProjectId"
          :session-revision="sessionRevision"
          :title-query="activeView === 'sessions' ? sessionTitleQuery : ''"
          :collector-id="activeView === 'sessions' ? selectedCollectorId : ''"
          :agent="activeView === 'sessions' ? selectedAgent : ''"
          @change="projectRevision++"
          @select="selectProject"
        />
        <keep-alive>
          <session-app
            v-if="activeView === 'sessions'"
            :client="client"
            :collector-id="selectedCollectorId"
            :agent="selectedAgent"
            :project-id="selectedProjectId"
            :project-name="selectedProjectName"
            :project-revision="projectRevision"
            :title-query="sessionTitleQuery"
            @sessions-refreshed="handleSessionsRefreshed"
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
