<script setup lang="ts">
import {
  ElAlert,
  ElButton,
  ElEmpty,
  ElInput,
  ElMessage,
  ElOption,
  ElSelect,
  ElTable,
  ElTableColumn,
  ElTag,
  ElTooltip,
  type TableInstance,
} from "element-plus"
import { Check, Pencil, RefreshCw, Search, X } from "lucide-vue-next"
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue"

import type {
  CollectorQueryWarning,
  ManagedCollectorInfo,
  SessionSummary,
} from "@nexume/contracts"

import type { CollectorClient, SessionClient } from "./client"
import PageToolbar from "./PageToolbar.vue"

const props = withDefaults(
  defineProps<{
    client: SessionClient
    collectorClient: CollectorClient
    initialCollectorId?: string
    projectId?: string
    projectName?: string
    projectRevision?: number
  }>(),
  {},
)

const emit = defineEmits<{
  "collector-change": [collectorId: string]
}>()

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})
const relativeTimeFormatter = new Intl.RelativeTimeFormat("en", {
  numeric: "auto",
})
const searchDebounceMs = 300
const loadMoreThreshold = 120

const sessions = ref<SessionSummary[]>([])
const collectors = ref<ManagedCollectorInfo[]>([])
const selectedCollectorId = ref(props.initialCollectorId ?? "")
const selectedAgent = ref("")
const titleQuery = ref("")
const appliedTitleQuery = ref("")
const nextCursor = ref<string>()
const hasMore = ref(false)
const warnings = ref<CollectorQueryWarning[]>([])
const loading = ref(false)
const collectorsLoading = ref(false)
const errorMessage = ref("")
const collectorsErrorMessage = ref("")
const editingSessionKey = ref("")
const editingTitle = ref("")
const savingSessionKey = ref("")
const table = ref<TableInstance>()
const tableRegion = ref<HTMLElement>()
let latestRequest = 0
let mounted = false
let initialActivation = true
let searchTimer: ReturnType<typeof setTimeout> | undefined

const resultSummary = computed(() =>
  sessions.value.length === 0
    ? "No sessions"
    : `${sessions.value.length.toLocaleString("en-US")} loaded`,
)
const warningMessage = computed(() =>
  warnings.value
    .map((warning) => `${warning.collectorName}: ${warning.message}`)
    .join("; "),
)
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

function getRowKey(session: SessionSummary): string {
  return `${session.collectorId}:${session.agent}:${session.id}`
}

function asSession(row: unknown): SessionSummary {
  return row as SessionSummary
}

async function startTitleEdit(session: SessionSummary): Promise<void> {
  editingSessionKey.value = getRowKey(session)
  editingTitle.value = session.title
  await nextTick()
  const input = tableRegion.value?.querySelector<HTMLInputElement>(
    ".session-title-editor input",
  )
  input?.focus()
  input?.select()
}

function cancelTitleEdit(): void {
  if (savingSessionKey.value) return
  editingSessionKey.value = ""
  editingTitle.value = ""
}

async function saveTitle(session: SessionSummary): Promise<void> {
  const title = editingTitle.value.trim()
  if (!title) {
    ElMessage.error("Enter a session title.")
    return
  }
  if (title === session.title) {
    cancelTitleEdit()
    return
  }

  const key = getRowKey(session)
  savingSessionKey.value = key
  try {
    const updated = await props.client.updateSessionTitle(session.collectorId, {
      agent: session.agent,
      id: session.id,
      title,
      expectedTitle: session.title,
      expectedUpdatedAt: session.updatedAt,
    })
    const index = sessions.value.findIndex(
      (item) => getRowKey(item) === getRowKey(updated),
    )
    if (index >= 0) sessions.value[index] = updated
    editingSessionKey.value = ""
    editingTitle.value = ""
    ElMessage.success("Session title updated.")
  } catch (error) {
    ElMessage.error(
      error instanceof Error
        ? error.message
        : "Unable to update the session title.",
    )
    editingSessionKey.value = ""
    editingTitle.value = ""
    await loadSessions(false)
  } finally {
    savingSessionKey.value = ""
  }
}

function formatExactTime(timestamp: number): string {
  const parts = Object.fromEntries(
    dateFormatter
      .formatToParts(new Date(timestamp))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
}

function formatRelativeTime(timestamp: number): string {
  const elapsedSeconds = Math.round((timestamp - Date.now()) / 1_000)
  const absoluteSeconds = Math.abs(elapsedSeconds)

  if (absoluteSeconds < 60) {
    return relativeTimeFormatter.format(elapsedSeconds, "second")
  }

  const elapsedMinutes = Math.round(elapsedSeconds / 60)
  if (Math.abs(elapsedMinutes) < 60) {
    return relativeTimeFormatter.format(elapsedMinutes, "minute")
  }

  const elapsedHours = Math.round(elapsedMinutes / 60)
  if (Math.abs(elapsedHours) < 24) {
    return relativeTimeFormatter.format(elapsedHours, "hour")
  }

  const elapsedDays = Math.round(elapsedHours / 24)
  if (Math.abs(elapsedDays) < 30) {
    return relativeTimeFormatter.format(elapsedDays, "day")
  }

  return formatExactTime(timestamp)
}

async function loadSessions(append = false): Promise<void> {
  if (append && (loading.value || !hasMore.value)) return

  const requestId = ++latestRequest
  loading.value = true
  errorMessage.value = ""

  try {
    const result = await props.client.listSessions({
      limit: 50,
      cursor: append ? nextCursor.value : undefined,
      collectorId: selectedCollectorId.value || undefined,
      projectId: props.projectId,
      unassigned: !props.projectId,
      agent: selectedAgent.value || undefined,
      title: appliedTitleQuery.value || undefined,
    })

    if (requestId !== latestRequest) return

    sessions.value = append
      ? [...sessions.value, ...result.items]
      : result.items
    nextCursor.value = result.nextCursor
    hasMore.value = result.hasMore
    warnings.value = append
      ? [
          ...new Map(
            [...warnings.value, ...result.warnings].map((warning) => [
              warning.collectorId,
              warning,
            ]),
          ).values(),
        ]
      : result.warnings
    await nextTick()

    if (!append) {
      table.value?.setScrollTop(0)
      table.value?.setScrollLeft(0)
    }
  } catch (error) {
    if (requestId !== latestRequest) return
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to load sessions."
  } finally {
    if (requestId === latestRequest) {
      loading.value = false
    }
  }
}

async function loadCollectors(): Promise<void> {
  if (collectorsLoading.value) return

  collectorsLoading.value = true
  collectorsErrorMessage.value = ""
  try {
    collectors.value = await props.collectorClient.list()
  } catch (error) {
    collectorsErrorMessage.value =
      error instanceof Error ? error.message : "Unable to load collectors."
  } finally {
    collectorsLoading.value = false
  }
}

function resetAndLoadSessions(): void {
  nextCursor.value = undefined
  hasMore.value = false
  void loadSessions(false)
}

function applyTitleSearch(): void {
  if (searchTimer !== undefined) clearTimeout(searchTimer)
  searchTimer = undefined
  const nextTitle = titleQuery.value.trim()
  if (nextTitle === appliedTitleQuery.value) return

  appliedTitleQuery.value = nextTitle
  resetAndLoadSessions()
}

function handleTitleInput(): void {
  if (searchTimer !== undefined) clearTimeout(searchTimer)
  searchTimer = setTimeout(applyTitleSearch, searchDebounceMs)
}

function handleTableScroll({ scrollTop }: { scrollTop: number }): void {
  const scrollContainer = tableRegion.value?.querySelector<HTMLElement>(
    ".el-scrollbar__wrap",
  )
  if (!scrollContainer) return

  const distanceToBottom =
    scrollContainer.scrollHeight - scrollContainer.clientHeight - scrollTop
  if (distanceToBottom <= loadMoreThreshold) {
    void loadSessions(true)
  }
}

function handleCollectorChange(): void {
  selectedAgent.value = ""
  emit("collector-change", selectedCollectorId.value)
  resetAndLoadSessions()
}

function handleAgentChange(): void {
  resetAndLoadSessions()
}

async function refresh(): Promise<void> {
  await Promise.all([loadCollectors(), loadSessions(false)])
}

watch(
  () => props.initialCollectorId,
  (collectorId) => {
    const nextCollectorId = collectorId ?? ""
    if (nextCollectorId === selectedCollectorId.value) return

    selectedCollectorId.value = nextCollectorId
    selectedAgent.value = ""
    if (mounted) resetAndLoadSessions()
  },
)

watch(
  () => props.projectId,
  () => {
    if (mounted) resetAndLoadSessions()
  },
)

watch(
  () => props.projectRevision,
  () => {
    if (mounted) resetAndLoadSessions()
  },
)

onMounted(() => {
  mounted = true
  void refresh()
})

onBeforeUnmount(() => {
  if (searchTimer !== undefined) clearTimeout(searchTimer)
})

onActivated(() => {
  if (initialActivation) {
    initialActivation = false
    return
  }
  void refresh()
})
</script>

<template>
  <section class="app-view session-view">
    <page-toolbar :title="projectName ?? 'Unassigned'" :summary="resultSummary">
      <template #actions>
        <el-tooltip content="Refresh sessions" placement="bottom">
          <el-button
            class="refresh-button"
            circle
            :loading="loading"
            aria-label="Refresh sessions"
            @click="refresh"
          >
            <refresh-cw :size="17" :stroke-width="1.8" />
          </el-button>
        </el-tooltip>
      </template>
    </page-toolbar>

    <section class="session-filter-toolbar" aria-label="Session filters">
      <label class="session-filter-field session-search-field">
        <span>Title</span>
        <el-input
          v-model="titleQuery"
          class="session-filter-input"
          :prefix-icon="Search"
          placeholder="Search titles"
          maxlength="256"
          clearable
          aria-label="Search sessions by title"
          @input="handleTitleInput"
          @clear="applyTitleSearch"
          @keyup.enter="applyTitleSearch"
        />
      </label>

      <label class="session-filter-field">
        <span>Collector</span>
        <el-select
          v-model="selectedCollectorId"
          class="session-filter-select"
          :loading="collectorsLoading"
          placeholder="All collectors"
          aria-label="Filter by collector"
          @change="handleCollectorChange"
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

      <label class="session-filter-field">
        <span>Agent</span>
        <el-select
          v-model="selectedAgent"
          class="session-filter-select"
          placeholder="All agents"
          aria-label="Filter by agent"
          @change="handleAgentChange"
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

    <el-alert
      v-if="errorMessage"
      class="error-alert"
      :title="errorMessage"
      type="error"
      show-icon
      :closable="false"
    >
      <template #default>
        <el-button size="small" @click="loadSessions(false)">Retry</el-button>
      </template>
    </el-alert>

    <el-alert
      v-if="warningMessage"
      class="warning-alert"
      :title="warningMessage"
      type="warning"
      show-icon
      :closable="false"
    />

    <el-alert
      v-if="collectorsErrorMessage"
      class="warning-alert"
      :title="collectorsErrorMessage"
      type="warning"
      show-icon
      :closable="false"
    />

    <section ref="tableRegion" class="table-region" aria-label="Session list">
      <el-table
        ref="table"
        v-loading="loading"
        :data="sessions"
        height="100%"
        :row-key="getRowKey"
        table-layout="fixed"
        scrollbar-always-on
        @scroll="handleTableScroll"
      >
        <el-table-column label="Title" min-width="290">
          <template #default="{ row }">
            <div
              v-if="editingSessionKey === getRowKey(asSession(row))"
              class="session-title-editor"
            >
              <el-input
                v-model="editingTitle"
                size="small"
                maxlength="4096"
                aria-label="Session title"
                @keyup.enter="saveTitle(asSession(row))"
                @keyup.esc="cancelTitleEdit"
              />
              <el-tooltip content="Save title" placement="top">
                <el-button
                  class="session-title-action"
                  text
                  circle
                  :loading="savingSessionKey === getRowKey(asSession(row))"
                  aria-label="Save session title"
                  @click.stop="saveTitle(asSession(row))"
                >
                  <check :size="15" />
                </el-button>
              </el-tooltip>
              <el-tooltip content="Cancel" placement="top">
                <el-button
                  class="session-title-action"
                  text
                  circle
                  :disabled="savingSessionKey === getRowKey(asSession(row))"
                  aria-label="Cancel session title edit"
                  @click.stop="cancelTitleEdit"
                >
                  <x :size="15" />
                </el-button>
              </el-tooltip>
            </div>
            <div v-else class="session-title-display">
              <span class="session-title" :title="row.title">{{
                row.title || "Untitled session"
              }}</span>
              <el-tooltip content="Edit title" placement="top">
                <el-button
                  class="session-title-action session-title-edit"
                  text
                  circle
                  aria-label="Edit session title"
                  @click.stop="startTitleEdit(asSession(row))"
                >
                  <pencil :size="14" />
                </el-button>
              </el-tooltip>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="Collector" width="140" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.collectorName }}
          </template>
        </el-table-column>

        <el-table-column label="Agent" width="120" show-overflow-tooltip>
          <template #default="{ row }">
            <el-tag effect="plain" size="small">{{ row.agent }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column
          prop="directory"
          label="Directory"
          min-width="260"
          show-overflow-tooltip
        />

        <el-table-column label="Updated" width="160">
          <template #default="{ row }">
            <el-tooltip
              :content="formatExactTime(row.updatedAt)"
              placement="top"
            >
              <span class="updated-time">{{
                formatRelativeTime(row.updatedAt)
              }}</span>
            </el-tooltip>
          </template>
        </el-table-column>

        <el-table-column label="Session ID" width="210" show-overflow-tooltip>
          <template #default="{ row }">
            <code class="session-id">{{ row.id }}</code>
          </template>
        </el-table-column>

        <template #empty>
          <el-empty
            :image-size="64"
            :description="
              errorMessage ? 'Sessions are unavailable' : 'No sessions found'
            "
          />
        </template>
      </el-table>
    </section>
  </section>
</template>
