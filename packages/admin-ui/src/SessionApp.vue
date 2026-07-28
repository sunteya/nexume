<script setup lang="ts">
import {
  ElAlert,
  ElButton,
  ElConfigProvider,
  ElEmpty,
  ElTable,
  ElTableColumn,
  ElTag,
  ElTooltip,
  type TableInstance,
} from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import { ChevronDown, RefreshCw } from "lucide-vue-next";
import { computed, nextTick, onMounted, ref } from "vue";

import type {
  CollectorQueryWarning,
  SessionSummary,
} from "@nexume/contracts";

import type { SessionClient } from "./client";

const props = withDefaults(
  defineProps<{
    client: SessionClient;
    sourceLabel?: string;
  }>(),
  {
    sourceLabel: "本机",
  },
);

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
const nextCursor = ref<string>();
const hasMore = ref(false);
const warnings = ref<CollectorQueryWarning[]>([]);
const loading = ref(false);
const errorMessage = ref("");
const table = ref<TableInstance>();
let latestRequest = 0;

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
  if (loading.value || (append && !hasMore.value)) return;

  const requestId = ++latestRequest;
  loading.value = true;
  errorMessage.value = "";

  try {
    const result = await props.client.listSessions({
      limit: 50,
      cursor: append ? nextCursor.value : undefined,
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

onMounted(() => void loadSessions());
</script>

<template>
  <el-config-provider :locale="zhCn">
    <main class="app-shell">
      <header class="app-header">
        <div class="brand-mark" aria-hidden="true">N</div>

        <div class="page-heading">
          <h1>Sessions</h1>
          <div class="source-line">
            <el-tag effect="plain" size="small">OpenCode</el-tag>
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
            @click="loadSessions(false)"
          >
            <refresh-cw :size="17" :stroke-width="1.8" />
          </el-button>
        </el-tooltip>
      </header>

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

      <section class="table-region" aria-label="OpenCode Session 列表">
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
              :description="errorMessage ? '暂时无法读取 Session' : '未发现 OpenCode Session'"
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
