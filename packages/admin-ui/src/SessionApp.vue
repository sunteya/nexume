<script setup lang="ts">
import {
  ElAlert,
  ElButton,
  ElDialog,
  ElEmpty,
  ElInput,
  ElMessage,
  ElTable,
  ElTableColumn,
  ElTag,
  ElTooltip,
  type TableInstance,
} from "element-plus"
import {
  ArrowLeft,
  Brain,
  CircleCheck,
  CircleX,
  FileText,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-vue-next"
import {
  computed,
  nextTick,
  onActivated,
  onMounted,
  ref,
  watch,
} from "vue"

import type {
  CollectorQueryWarning,
  SessionDetailMessage,
  SessionDetailPart,
  SessionSummary,
} from "@nexume/contracts"

import type { SessionClient } from "./client"
import { renderMarkdown } from "./markdown"
import PageToolbar from "./PageToolbar.vue"

const props = withDefaults(
  defineProps<{
    client: SessionClient
    collectorId?: string
    agent?: string
    projectId?: string
    projectName?: string
    projectRevision?: number
    titleQuery?: string
  }>(),
  {},
)

const emit = defineEmits<{
  "sessions-refreshed": []
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
const logTimeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
})
const loadMoreThreshold = 120

type TitleSuggestionLogState = "active" | "complete" | "error"

interface TitleSuggestionLog {
  id: number
  time: string
  message: string
  state: TitleSuggestionLogState
}

const sessions = ref<SessionSummary[]>([])
const nextCursor = ref<string>()
const hasMore = ref(false)
const warnings = ref<CollectorQueryWarning[]>([])
const loading = ref(false)
const errorMessage = ref("")
const editingSessionKey = ref("")
const editingTitle = ref("")
const titleDialogVisible = ref(false)
const savingSessionKey = ref("")
const suggestingTitleSessionKey = ref("")
const titleSuggestionLogs = ref<TitleSuggestionLog[]>([])
const selectedSession = ref<SessionSummary>()
const detailMessages = ref<SessionDetailMessage[]>([])
const detailCursor = ref<string>()
const detailHasMore = ref(false)
const detailLoading = ref(false)
const detailErrorMessage = ref("")
const table = ref<TableInstance>()
const tableRegion = ref<HTMLElement>()
const detailRegion = ref<HTMLElement>()
const detailMessageRegion = ref<HTMLElement>()
let latestRequest = 0
let latestDetailRequest = 0
let latestTitleSuggestionRequest = 0
let nextTitleSuggestionLogId = 0
let mounted = false
let initialActivation = true

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
function getRowKey(session: SessionSummary): string {
  return `${session.collectorId}:${session.agent}:${session.id}`
}

function partHeading(part: SessionDetailPart): string {
  if (part.type === "reasoning") return "Reasoning"
  if (part.type === "tool-call") return part.name ? `Tool call: ${part.name}` : "Tool call"
  if (part.type === "tool-result") return part.name ? `Tool result: ${part.name}` : "Tool result"
  if (part.type === "file") return "File"
  if (part.type === "patch") return "Patch"
  return "Details"
}

function partLabel(part: SessionDetailPart): string {
  const heading = partHeading(part)
  return part.status ? `${heading} (${part.status})` : heading
}

function partIcon(part: SessionDetailPart) {
  if (part.type === "reasoning") return Brain
  if (part.type === "tool-call" || part.type === "tool-result") return Wrench
  return FileText
}

function isTextPart(part: SessionDetailPart): boolean {
  return part.type === "text" || part.type === "reasoning"
}

function isVisibleTextPart(part: SessionDetailPart): boolean {
  return isTextPart(part) && Boolean(part.text.trim())
}

function isCallPart(part: SessionDetailPart): boolean {
  return !isTextPart(part)
}

function formatReasoningText(text: string): string {
  return text.replace(/\*\*\*\*(?=\S)/g, "**\n**")
}

async function loadSessionDetail(append = false): Promise<void> {
  const session = selectedSession.value
  if (!session || (append && (!detailHasMore.value || detailLoading.value))) return

  const requestId = ++latestDetailRequest
  const sessionKey = getRowKey(session)
  detailLoading.value = true
  detailErrorMessage.value = ""
  try {
    const page = await props.client.getSessionDetail(session.collectorId, {
      agent: session.agent,
      id: session.id,
      limit: 20,
      cursor: append ? detailCursor.value : undefined,
    })
    if (
      requestId !== latestDetailRequest ||
      !selectedSession.value ||
      getRowKey(selectedSession.value) !== sessionKey
    ) {
      return
    }
    detailMessages.value = append
      ? [...detailMessages.value, ...page.items]
      : page.items
    detailCursor.value = page.nextCursor
    detailHasMore.value = page.hasMore
  } catch (error) {
    if (requestId !== latestDetailRequest) return
    detailErrorMessage.value =
      error instanceof Error ? error.message : "Unable to load session details."
  } finally {
    if (requestId === latestDetailRequest) detailLoading.value = false
  }

  if (requestId === latestDetailRequest && detailHasMore.value) {
    await nextTick()
    const region = detailMessageRegion.value
    if (
      region &&
      region.scrollHeight - region.clientHeight - region.scrollTop <=
        loadMoreThreshold
    ) {
      void loadSessionDetail(true)
    }
  }
}

function handleDetailScroll(event: Event): void {
  const region = event.currentTarget as HTMLElement
  const distanceToBottom =
    region.scrollHeight - region.clientHeight - region.scrollTop
  if (distanceToBottom <= loadMoreThreshold) {
    void loadSessionDetail(true)
  }
}

function openSessionDetail(session: SessionSummary): void {
  latestDetailRequest += 1
  cancelTitleEdit()
  selectedSession.value = session
  detailMessages.value = []
  detailCursor.value = undefined
  detailHasMore.value = false
  detailErrorMessage.value = ""
  void loadSessionDetail(false)
}

function clearSessionDetail(): void {
  latestDetailRequest += 1
  selectedSession.value = undefined
  detailMessages.value = []
  detailCursor.value = undefined
  detailHasMore.value = false
  detailLoading.value = false
  detailErrorMessage.value = ""
}

function closeSessionDetail(): void {
  cancelTitleEdit()
  clearSessionDetail()
}

async function startTitleEdit(session: SessionSummary): Promise<void> {
  latestTitleSuggestionRequest += 1
  suggestingTitleSessionKey.value = ""
  titleSuggestionLogs.value = []
  editingSessionKey.value = getRowKey(session)
  editingTitle.value = session.title
  titleDialogVisible.value = true
  await nextTick()
  const input = document.querySelector<HTMLInputElement>(
    ".session-title-dialog input",
  )
  input?.focus()
  input?.select()
}

function cancelTitleEdit(): void {
  if (savingSessionKey.value) return
  latestTitleSuggestionRequest += 1
  suggestingTitleSessionKey.value = ""
  titleSuggestionLogs.value = []
  titleDialogVisible.value = false
  editingSessionKey.value = ""
  editingTitle.value = ""
}

function handleTitleDialogClosed(): void {
  if (!savingSessionKey.value) cancelTitleEdit()
}

function appendTitleSuggestionLog(
  message: string,
  state: TitleSuggestionLogState = "active",
): void {
  titleSuggestionLogs.value = [
    ...titleSuggestionLogs.value.map((entry) =>
      entry.state === "active"
        ? { ...entry, state: "complete" as const }
        : entry,
    ),
    {
      id: ++nextTitleSuggestionLogId,
      time: logTimeFormatter.format(new Date()),
      message,
      state,
    },
  ]
}

async function suggestTitle(session: SessionSummary): Promise<void> {
  const key = getRowKey(session)
  if (suggestingTitleSessionKey.value) return

  const requestId = ++latestTitleSuggestionRequest
  suggestingTitleSessionKey.value = key
  titleSuggestionLogs.value = []
  appendTitleSuggestionLog("Starting title generation.")
  try {
    const suggestion = await props.client.suggestSessionTitle(
      session.collectorId,
      {
        agent: session.agent,
        id: session.id,
      },
      (message) => {
        if (
          requestId === latestTitleSuggestionRequest &&
          editingSessionKey.value === key
        ) {
          appendTitleSuggestionLog(message)
        }
      },
    )
    if (
      requestId !== latestTitleSuggestionRequest ||
      editingSessionKey.value !== key
    ) {
      return
    }
    editingTitle.value = suggestion.title
    appendTitleSuggestionLog("Title suggestion received.", "complete")
    await nextTick()
    document
      .querySelector<HTMLInputElement>(".session-title-dialog input")
      ?.focus()
  } catch (error) {
    if (requestId !== latestTitleSuggestionRequest) return
    appendTitleSuggestionLog(
      error instanceof Error ? error.message : "Title generation failed.",
      "error",
    )
    ElMessage.error(
      error instanceof Error
        ? error.message
        : "Unable to generate a session title.",
    )
  } finally {
    if (requestId === latestTitleSuggestionRequest) {
      suggestingTitleSessionKey.value = ""
    }
  }
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
    if (
      selectedSession.value &&
      getRowKey(selectedSession.value) === getRowKey(updated)
    ) {
      selectedSession.value = updated
    }
    editingSessionKey.value = ""
    editingTitle.value = ""
    titleDialogVisible.value = false
    ElMessage.success("Session title updated.")
  } catch (error) {
    ElMessage.error(
      error instanceof Error
        ? error.message
        : "Unable to update the session title.",
    )
    editingSessionKey.value = ""
    editingTitle.value = ""
    titleDialogVisible.value = false
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
      collectorId: props.collectorId || undefined,
      projectId: props.projectId,
      unassigned: !props.projectId,
      agent: props.agent || undefined,
      title: props.titleQuery || undefined,
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

function resetAndLoadSessions(): void {
  closeSessionDetail()
  nextCursor.value = undefined
  hasMore.value = false
  void loadSessions(false)
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

async function refresh(): Promise<void> {
  await loadSessions(false)
  emit("sessions-refreshed")
}

watch(
  () => [props.collectorId, props.agent] as const,
  () => {
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

watch(
  () => props.titleQuery,
  () => {
    if (mounted) resetAndLoadSessions()
  },
)

onMounted(() => {
  mounted = true
  void refresh()
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
  <section
    v-if="selectedSession"
    ref="detailRegion"
    class="app-view session-detail-view"
  >
    <page-toolbar
      class="session-detail-toolbar"
      :title="selectedSession.title || 'Untitled session'"
    >
      <template #leading>
        <el-tooltip content="Back to sessions" placement="bottom">
          <el-button
            class="refresh-button"
            circle
            aria-label="Back to sessions"
            @click="closeSessionDetail"
          >
            <arrow-left :size="17" :stroke-width="1.8" />
          </el-button>
        </el-tooltip>
      </template>
      <template #metadata>
        <span class="session-detail-directory" :title="selectedSession.directory">
          {{ selectedSession.directory }}
        </span>
      </template>
      <template #actions>
        <el-tooltip content="Edit title" placement="bottom">
          <el-button
            class="refresh-button"
            circle
            aria-label="Edit session title"
            @click="startTitleEdit(selectedSession)"
          >
            <pencil :size="16" />
          </el-button>
        </el-tooltip>
      </template>
    </page-toolbar>

    <el-dialog
      v-model="titleDialogVisible"
      class="session-title-dialog"
      title="Edit session title"
      width="min(92vw, 520px)"
      :close-on-click-modal="!savingSessionKey"
      :close-on-press-escape="!savingSessionKey"
      :show-close="!savingSessionKey"
      @closed="handleTitleDialogClosed"
    >
      <form
        class="session-title-dialog-form"
        @submit.prevent="saveTitle(selectedSession)"
      >
        <label for="session-title-input">Title</label>
        <el-input
          id="session-title-input"
          v-model="editingTitle"
          maxlength="4096"
          :disabled="suggestingTitleSessionKey === getRowKey(selectedSession)"
          autofocus
        />
      </form>
      <section
        v-if="titleSuggestionLogs.length > 0"
        class="session-title-ai-log"
        aria-label="AI activity"
        aria-live="polite"
      >
        <header>
          <terminal :size="14" aria-hidden="true" />
          <span>AI activity</span>
        </header>
        <ol>
          <li
            v-for="entry in titleSuggestionLogs"
            :key="entry.id"
            :class="`is-${entry.state}`"
          >
            <loader-circle
              v-if="entry.state === 'active'"
              class="session-title-log-spinner"
              :size="13"
              aria-hidden="true"
            />
            <circle-check
              v-else-if="entry.state === 'complete'"
              :size="13"
              aria-hidden="true"
            />
            <circle-x v-else :size="13" aria-hidden="true" />
            <time>{{ entry.time }}</time>
            <span>{{ entry.message }}</span>
          </li>
        </ol>
      </section>
      <template #footer>
        <div class="session-title-dialog-actions">
          <el-button
            :icon="Sparkles"
            :loading="suggestingTitleSessionKey === getRowKey(selectedSession)"
            :disabled="Boolean(savingSessionKey)"
            @click="suggestTitle(selectedSession)"
          >
            Generate with AI
          </el-button>
          <div class="session-title-dialog-confirmation">
            <el-button
              :disabled="Boolean(savingSessionKey)"
              @click="cancelTitleEdit"
            >
              Cancel
            </el-button>
            <el-button
              type="primary"
              :loading="savingSessionKey === getRowKey(selectedSession)"
              :disabled="
                suggestingTitleSessionKey === getRowKey(selectedSession)
              "
              @click="saveTitle(selectedSession)"
            >
              Save
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>

    <section class="session-detail-body" aria-label="Session details">
      <el-alert
        v-if="detailErrorMessage"
        :title="detailErrorMessage"
        type="error"
        show-icon
        :closable="false"
      >
        <template #default>
          <el-button size="small" @click="loadSessionDetail(false)">Retry</el-button>
        </template>
      </el-alert>

      <div
        ref="detailMessageRegion"
        v-loading="detailLoading && detailMessages.length === 0"
        class="session-message-region"
        @scroll="handleDetailScroll"
      >
        <el-empty
          v-if="
            !detailLoading &&
            !detailErrorMessage &&
            detailMessages.length === 0
          "
          :image-size="56"
          description="No message details found"
        />

        <article
          v-for="message in detailMessages"
          :key="message.id"
          class="session-message"
          :class="`is-${message.role}`"
        >
          <header class="session-message-header">
            <strong>{{ message.role }}</strong>
            <time>{{ formatExactTime(message.createdAt) }}</time>
          </header>
          <div class="session-message-content">
            <template
              v-for="part in message.parts.filter(isVisibleTextPart)"
              :key="part.id"
            >
              <div
                v-if="part.type === 'text'"
                class="session-message-markdown"
                v-html="renderMarkdown(part.text)"
              />
              <div v-else class="session-reasoning">
                <brain :size="16" aria-hidden="true" />
                <pre>{{ formatReasoningText(part.text) }}</pre>
              </div>
            </template>
            <div
              v-if="message.parts.some(isCallPart)"
              class="session-message-call-row"
            >
              <template
                v-for="part in message.parts.filter(isCallPart)"
                :key="part.id"
              >
                <details
                  class="session-message-detail session-message-call-detail"
                  :data-status="part.status"
                >
                  <summary
                    :aria-label="partLabel(part)"
                    :title="partLabel(part)"
                  >
                    <component :is="partIcon(part)" :size="15" />
                  </summary>
                  <pre>{{ part.text }}</pre>
                </details>
              </template>
            </div>
          </div>
        </article>

        <div
          v-if="detailLoading && detailMessages.length > 0"
          class="session-detail-pagination"
          aria-label="Loading more session messages"
        >
          <loader-circle :size="18" class="session-detail-loading-icon" />
        </div>
      </div>
    </section>
  </section>

  <section v-else class="app-view session-view">
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
        @row-click="openSessionDetail"
      >
        <el-table-column label="Title" min-width="290">
          <template #default="{ row }">
            <span class="session-title" :title="row.title">
              {{ row.title || "Untitled session" }}
            </span>
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
              <span class="updated-time">
                {{ formatRelativeTime(row.updatedAt) }}
              </span>
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
