<script setup lang="ts">
import {
  ElAlert,
  ElButton,
  ElConfigProvider,
  ElEmpty,
  ElOption,
  ElSelect,
  ElTable,
  ElTableColumn,
  ElTag,
  ElTooltip,
  type TableInstance,
} from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import { ChevronDown, RefreshCw } from "lucide-vue-next";
import { computed, nextTick, onMounted, ref, watch } from "vue";

import type {
  CollectorQueryWarning,
  ManagedCollectorInfo,
  SessionSummary,
} from "@nexume/contracts";

import type { CollectorClient, SessionClient } from "./client";

const props = withDefaults(
  defineProps<{
    client: SessionClient;
    collectorClient: CollectorClient;
    initialCollectorId?: string;
    sourceLabel?: string;
  }>(),
  {
    sourceLabel: "本机",
  },
);

const emit = defineEmits<{
  "collector-change": [collectorId: string];
}>();

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const relativeTimeFormatter = new Intl.RelativeTimeFormat("zh-CN", {
  numeric: "auto",
});

const sessions = ref<SessionSummary[]>([]);
const collectors = ref<ManagedCollectorInfo[]>([]);
const selectedCollectorId = ref(props.initialCollectorId ?? "");
const selectedAgent = ref("");
const nextCursor = ref<string>();
const hasMore = ref(false);
const warnings = ref<CollectorQueryWarning[]>([]);
const loading = ref(false);
const collectorsLoading = ref(false);
const errorMessage = ref("");
const collectorsErrorMessage = ref("");
const table = ref<TableInstance>();
let latestRequest = 0;
let mounted = false;

const resultSummary = computed(() =>
  sessions.value.length === 0
    ? "尚无 Session"
    : `已加载 ${sessions.value.length.toLocaleString("zh-CN")} 条`,
);
const warningMessage = computed(() =>
  warnings.value
    .map((warning) => `${warning.collectorName}：${warning.message}`)
    .join("；"),
);
const agentOptions = computed(() => {
  const availableCollectors = selectedCollectorId.value
    ? collectors.value.filter(
        (collector) => collector.id === selectedCollectorId.value,
      )
    : collectors.value;

  return [...new Set(availableCollectors.flatMap((collector) => collector.agents))]
    .sort((left, right) => left.localeCompare(right, "zh-CN"));
});

function getProjectName(directory: string): string {
  return directory.split(/[\\/]/).filter(Boolean).at(-1) ?? directory;
}

function getRowKey(session: SessionSummary): string {
  return `${session.collectorId}:${session.agent}:${session.id}`;
}

function formatExactTime(timestamp: number): string {
  return dateFormatter.format(new Date(timestamp));
}

function formatRelativeTime(timestamp: number): string {
  const elapsedSeconds = Math.round((timestamp - Date.now()) / 1_000);
  const absoluteSeconds = Math.abs(elapsedSeconds);

  if (absoluteSeconds < 60) {
    return relativeTimeFormatter.format(elapsedSeconds, "second");
  }

  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (Math.abs(elapsedMinutes) < 60) {
    return relativeTimeFormatter.format(elapsedMinutes, "minute");
  }

  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (Math.abs(elapsedHours) < 24) {
    return relativeTimeFormatter.format(elapsedHours, "hour");
  }

  const elapsedDays = Math.round(elapsedHours / 24);
  if (Math.abs(elapsedDays) < 30) {
    return relativeTimeFormatter.format(elapsedDays, "day");
  }

  return formatExactTime(timestamp);
}

async function loadSessions(append = false): Promise<void> {
  if (append && (loading.value || !hasMore.value)) return;

  const requestId = ++latestRequest;
  loading.value = true;
  errorMessage.value = "";

  try {
    const result = await props.client.listSessions({
      limit: 50,
      cursor: append ? nextCursor.value : undefined,
      collectorId: selectedCollectorId.value || undefined,
      agent: selectedAgent.value || undefined,
    });

    if (requestId !== latestRequest) return;

    sessions.value = append
      ? [...sessions.value, ...result.items]
      : result.items;
    nextCursor.value = result.nextCursor;
    hasMore.value = result.hasMore;
    warnings.value = append
      ? [
          ...new Map(
            [...warnings.value, ...result.warnings].map((warning) => [
              warning.collectorId,
              warning,
            ]),
          ).values(),
        ]
      : result.warnings;
    await nextTick();

    if (!append) {
      table.value?.setScrollTop(0);
      table.value?.setScrollLeft(0);
    }
  } catch (error) {
    if (requestId !== latestRequest) return;
    errorMessage.value =
      error instanceof Error ? error.message : "读取 Session 失败。";
  } finally {
    if (requestId === latestRequest) loading.value = false;
  }
}

async function loadCollectors(): Promise<void> {
  if (collectorsLoading.value) return;

  collectorsLoading.value = true;
  collectorsErrorMessage.value = "";
  try {
    collectors.value = await props.collectorClient.list();
  } catch (error) {
    collectorsErrorMessage.value =
      error instanceof Error ? error.message : "读取 Collector 失败。";
  } finally {
    collectorsLoading.value = false;
  }
}

function resetAndLoadSessions(): void {
  nextCursor.value = undefined;
  hasMore.value = false;
  void loadSessions(false);
}

function handleCollectorChange(): void {
  selectedAgent.value = "";
  emit("collector-change", selectedCollectorId.value);
  resetAndLoadSessions();
}

function handleAgentChange(): void {
  resetAndLoadSessions();
}

async function refresh(): Promise<void> {
  await Promise.all([loadCollectors(), loadSessions(false)]);
}

watch(
  () => props.initialCollectorId,
  (collectorId) => {
    const nextCollectorId = collectorId ?? "";
    if (nextCollectorId === selectedCollectorId.value) return;

    selectedCollectorId.value = nextCollectorId;
    selectedAgent.value = "";
    if (mounted) resetAndLoadSessions();
  },
);

onMounted(() => {
  mounted = true;
  void refresh();
});
</script>

<template>
  <el-config-provider :locale="zhCn">
    <main class="app-shell">
      <header class="app-header">
        <div class="brand-mark" aria-hidden="true">N</div>

        <div class="page-heading">
          <h1>Sessions</h1>
          <div class="source-line">
            <span>{{ sourceLabel }}</span>
            <span class="source-separator" aria-hidden="true"></span>
            <span>{{ resultSummary }}</span>
          </div>
        </div>

        <slot name="header-actions" />

        <el-tooltip content="刷新 Session" placement="bottom">
          <el-button
            class="refresh-button"
            circle
            :loading="loading"
            aria-label="刷新 Session"
            @click="refresh"
          >
            <refresh-cw :size="17" :stroke-width="1.8" />
          </el-button>
        </el-tooltip>
      </header>

      <section class="session-filter-toolbar" aria-label="Session 筛选">
        <label class="session-filter-field">
          <span>Collector</span>
          <el-select
            v-model="selectedCollectorId"
            class="session-filter-select"
            :loading="collectorsLoading"
            placeholder="全部 Collector"
            aria-label="按 Collector 筛选"
            @change="handleCollectorChange"
          >
            <el-option label="全部 Collector" value="" />
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
            placeholder="全部 Agent"
            aria-label="按 Agent 筛选"
            @change="handleAgentChange"
          >
            <el-option label="全部 Agent" value="" />
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
          <el-button size="small" @click="loadSessions(false)">重新加载</el-button>
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

      <section class="table-region" aria-label="Session 列表">
        <el-table
          ref="table"
          v-loading="loading"
          :data="sessions"
          height="100%"
          :row-key="getRowKey"
          table-layout="fixed"
          scrollbar-always-on
        >
          <el-table-column label="标题" min-width="250" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="session-title">{{ row.title || "未命名 Session" }}</span>
            </template>
          </el-table-column>

          <el-table-column label="来源" width="130" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.collectorName }}
            </template>
          </el-table-column>

          <el-table-column label="Agent" width="120" show-overflow-tooltip>
            <template #default="{ row }">
              <el-tag effect="plain" size="small">{{ row.agent }}</el-tag>
            </template>
          </el-table-column>

          <el-table-column label="项目" width="140" show-overflow-tooltip>
            <template #default="{ row }">
              {{ getProjectName(row.directory) }}
            </template>
          </el-table-column>

          <el-table-column
            prop="directory"
            label="目录"
            min-width="260"
            show-overflow-tooltip
          />

          <el-table-column label="更新时间" width="160">
            <template #default="{ row }">
              <el-tooltip :content="formatExactTime(row.updatedAt)" placement="top">
                <span class="updated-time">{{ formatRelativeTime(row.updatedAt) }}</span>
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
              :description="errorMessage ? '暂时无法读取 Session' : '未发现 Session'"
            />
          </template>
        </el-table>
      </section>

      <footer class="load-more-bar">
        <span>{{ resultSummary }}</span>
        <el-button
          v-if="hasMore"
          :loading="loading"
          :icon="ChevronDown"
          @click="loadSessions(true)"
        >
          加载更多
        </el-button>
        <span v-else-if="sessions.length > 0">已加载全部</span>
      </footer>
    </main>
  </el-config-provider>
</template>
