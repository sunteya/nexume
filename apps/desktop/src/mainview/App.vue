<script setup lang="ts">
import {
  ElAlert,
  ElButton,
  ElConfigProvider,
  ElEmpty,
  ElPagination,
  ElTable,
  ElTableColumn,
  ElTag,
  ElTooltip,
  type TableInstance,
} from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import { RefreshCw } from "lucide-vue-next";
import { computed, nextTick, onMounted, ref } from "vue";

import {
  sessionPageSizes,
  type OpenCodeSessionSummary,
  type SessionPageSize,
} from "../shared/desktop-rpc";
import { desktopRpc } from "./rpc";

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

const sessions = ref<OpenCodeSessionSummary[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref<SessionPageSize>(50);
const loading = ref(false);
const errorMessage = ref("");
const table = ref<TableInstance>();
let latestRequest = 0;

const resultSummary = computed(() =>
  total.value === 0 ? "尚无 Session" : `共 ${total.value.toLocaleString("zh-CN")} 条`,
);

function getProjectName(directory: string): string {
  return directory.split(/[\\/]/).filter(Boolean).at(-1) ?? directory;
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

async function loadSessions(requestedPage = page.value): Promise<void> {
  const requestId = ++latestRequest;
  loading.value = true;
  errorMessage.value = "";

  try {
    const result = await desktopRpc.request.listOpenCodeSessions({
      page: requestedPage,
      pageSize: pageSize.value,
    });

    if (requestId !== latestRequest) return;

    sessions.value = result.items;
    total.value = result.total;
    page.value = result.page;
    pageSize.value = result.pageSize;
    await nextTick();
    table.value?.setScrollTop(0);
    table.value?.setScrollLeft(0);
  } catch (error) {
    if (requestId !== latestRequest) return;

    errorMessage.value =
      error instanceof Error ? error.message : "读取 OpenCode Session 失败。";
  } finally {
    if (requestId === latestRequest) loading.value = false;
  }
}

function handlePageChange(nextPage: number): void {
  page.value = nextPage;
  void loadSessions(nextPage);
}

function handlePageSizeChange(nextPageSize: number): void {
  if (!sessionPageSizes.includes(nextPageSize as SessionPageSize)) return;

  pageSize.value = nextPageSize as SessionPageSize;
  page.value = 1;
  void loadSessions(1);
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
            <span>本机</span>
            <span class="source-separator" aria-hidden="true"></span>
            <span>{{ resultSummary }}</span>
          </div>
        </div>

        <el-tooltip content="刷新 Session" placement="bottom">
          <el-button
            class="refresh-button"
            circle
            :loading="loading"
            aria-label="刷新 Session"
            @click="loadSessions()"
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
          <el-button size="small" @click="loadSessions()">重新加载</el-button>
        </template>
      </el-alert>

      <section class="table-region" aria-label="OpenCode Session 列表">
        <el-table
          ref="table"
          v-loading="loading"
          :data="sessions"
          height="100%"
          row-key="id"
          table-layout="fixed"
          scrollbar-always-on
        >
          <el-table-column label="标题" min-width="260" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="session-title">{{ row.title || "未命名 Session" }}</span>
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
            min-width="280"
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
              :description="
                errorMessage ? '暂时无法读取 Session' : '未发现 OpenCode Session'
              "
            />
          </template>
        </el-table>
      </section>

      <footer class="pagination-bar">
        <span>{{ resultSummary }}</span>
        <el-pagination
          v-if="total > 0"
          :current-page="page"
          :page-size="pageSize"
          :page-sizes="[...sessionPageSizes]"
          :total="total"
          layout="sizes, prev, pager, next"
          background
          @update:current-page="handlePageChange"
          @update:page-size="handlePageSizeChange"
        />
      </footer>
    </main>
  </el-config-provider>
</template>
