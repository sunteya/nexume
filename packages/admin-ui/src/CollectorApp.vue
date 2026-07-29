<script setup lang="ts">
import {
  ElAlert,
  ElButton,
  ElConfigProvider,
  ElDialog,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
  ElMessageBox,
  ElRadioButton,
  ElRadioGroup,
  ElTable,
  ElTableColumn,
  ElTag,
  ElTooltip,
  type DialogTransition,
} from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import {
  Check,
  Clipboard,
  Copy,
  KeyRound,
  List,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  X,
} from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";

import type {
  CollectorConnectionType,
  CreateCollectorInput,
  ManagedCollectorInfo,
  RuntimeInfo,
} from "@nexume/contracts";

import type { CollectorClient } from "./client";

const props = withDefaults(
  defineProps<{
    client: CollectorClient;
    allowRemoteCollectors?: boolean;
  }>(),
  { allowRemoteCollectors: true },
);

const emit = defineEmits<{
  "view-sessions": [collectorId: string];
}>();

const dialogTransition: DialogTransition = { css: false };

const collectors = ref<ManagedCollectorInfo[]>([]);
const loading = ref(false);
const errorMessage = ref("");
const createDialog = ref(false);
const createName = ref("");
const createType = ref<CollectorConnectionType>("local");
const creating = ref(false);
const renameDialog = ref(false);
const renameId = ref("");
const renameName = ref("");
const renaming = ref(false);
const tokenDialog = ref(false);
const tokenValue = ref("");
const tokenTitle = ref("Collector token");
const tokenLoading = ref(false);
const syncingCollectorIds = ref(new Set<string>());
const showTokenAfterCreate = ref(false);
const runtimeInfo = ref<RuntimeInfo>();

const hasLocalCollector = computed(() =>
  collectors.value.some((collector) => collector.connectionType === "local"),
);
const onlineCount = computed(
  () => collectors.value.filter((collector) => collector.online).length,
);

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function asCollector(value: unknown): ManagedCollectorInfo {
  return value as ManagedCollectorInfo;
}

function formatAgents(collector: ManagedCollectorInfo): string {
  return collector.agents.length > 0 ? collector.agents.join(", ") : "未知";
}

function formatLastActivity(timestamp: number | undefined): string {
  if (!timestamp) return "从未连接";
  const elapsedSeconds = Math.round((timestamp - Date.now()) / 1_000);
  const absoluteSeconds = Math.abs(elapsedSeconds);
  if (absoluteSeconds < 60) {
    return new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" }).format(
      elapsedSeconds,
      "second",
    );
  }

  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (Math.abs(elapsedMinutes) < 60) {
    return new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" }).format(
      elapsedMinutes,
      "minute",
    );
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function formatExactTime(timestamp: number | undefined): string {
  return timestamp
    ? new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(new Date(timestamp))
    : "从未连接";
}

async function loadCollectors(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  errorMessage.value = "";
  try {
    const [items, runtime] = await Promise.all([
      props.client.list(),
      props.client.getRuntimeInfo(),
    ]);
    collectors.value = items;
    runtimeInfo.value = runtime;
  } catch (error) {
    errorMessage.value = errorText(error, "读取 Collector 失败。");
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  createName.value = "";
  createType.value = props.allowRemoteCollectors && hasLocalCollector.value
    ? "remote"
    : "local";
  createDialog.value = true;
}

async function createCollector(): Promise<void> {
  const name = createName.value.trim();
  if (!name) {
    ElMessage.error("请输入 Collector 名称。");
    return;
  }

  const input: CreateCollectorInput = {
    name,
    connectionType: createType.value,
  };
  creating.value = true;
  try {
    const result = await props.client.create(input);
    createDialog.value = false;
    collectors.value = [
      ...collectors.value.filter((collector) => collector.id !== result.collector.id),
      result.collector,
    ].sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));

    if (result.token) {
      tokenTitle.value = `${result.collector.name} 的连接 token`;
      tokenValue.value = result.token;
      showTokenAfterCreate.value = true;
    } else {
      ElMessage.success("Collector 已创建。");
    }
  } catch (error) {
    ElMessage.error(errorText(error, "创建 Collector 失败。"));
  } finally {
    creating.value = false;
  }
}

function handleCreateClosed(): void {
  if (!showTokenAfterCreate.value) return;
  showTokenAfterCreate.value = false;
  tokenDialog.value = true;
}

function openRename(collector: ManagedCollectorInfo): void {
  renameId.value = collector.id;
  renameName.value = collector.name;
  renameDialog.value = true;
}

async function renameCollector(): Promise<void> {
  const name = renameName.value.trim();
  if (!name) {
    ElMessage.error("请输入 Collector 名称。");
    return;
  }

  renaming.value = true;
  try {
    const updated = await props.client.rename(renameId.value, { name });
    const index = collectors.value.findIndex((collector) => collector.id === updated.id);
    if (index >= 0) collectors.value[index] = updated;
    renameDialog.value = false;
    ElMessage.success("Collector 名称已更新。");
  } catch (error) {
    ElMessage.error(errorText(error, "修改 Collector 名称失败。"));
  } finally {
    renaming.value = false;
  }
}

async function deleteCollector(collector: ManagedCollectorInfo): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定删除 Collector “${collector.name}”吗？连接信息和已缓存的 Session 都会被移除。`,
      "删除 Collector",
      {
        type: "warning",
        confirmButtonText: "删除",
        cancelButtonText: "取消",
      },
    );
  } catch {
    return;
  }

  try {
    await props.client.delete(collector.id);
    collectors.value = collectors.value.filter((item) => item.id !== collector.id);
    ElMessage.success("Collector 已删除。");
  } catch (error) {
    ElMessage.error(errorText(error, "删除 Collector 失败。"));
  }
}

async function showToken(collector: ManagedCollectorInfo): Promise<void> {
  tokenLoading.value = true;
  try {
    const result = await props.client.getToken(collector.id);
    tokenTitle.value = `${collector.name} 的连接 token`;
    tokenValue.value = result.token;
    tokenDialog.value = true;
  } catch (error) {
    ElMessage.error(errorText(error, "读取 Collector token 失败。"));
  } finally {
    tokenLoading.value = false;
  }
}

async function syncCollector(collector: ManagedCollectorInfo): Promise<void> {
  syncingCollectorIds.value = new Set(syncingCollectorIds.value).add(collector.id);
  try {
    await props.client.sync(collector.id);
    ElMessage.success(`已触发 ${collector.name} 同步。`);
  } catch (error) {
    ElMessage.error(errorText(error, "触发 Collector 同步失败。"));
  } finally {
    const next = new Set(syncingCollectorIds.value);
    next.delete(collector.id);
    syncingCollectorIds.value = next;
  }
}

async function copyToken(): Promise<void> {
  await copyText(tokenValue.value, "token 已复制。");
}

async function copyText(value: string, success: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    ElMessage.success(success);
  } catch {
    ElMessage.error("复制失败，请手动复制 token。");
  }
}

onMounted(() => void loadCollectors());
</script>

<template>
  <el-config-provider :locale="zhCn">
    <main class="app-shell collector-shell">
      <header class="app-header collector-header">
        <div class="brand-mark" aria-hidden="true">N</div>

        <div class="page-heading">
          <h1>Collectors</h1>
          <div class="source-line">
            <el-tag effect="plain" size="small">管理</el-tag>
            <span>{{ collectors.length }} 个 Collector</span>
            <span class="source-separator" aria-hidden="true"></span>
            <span>{{ onlineCount }} 个在线</span>
          </div>
        </div>

        <slot name="header-actions" />

        <el-tooltip content="刷新 Collector" placement="bottom">
          <el-button
            class="refresh-button"
            circle
            :loading="loading"
            aria-label="刷新 Collector"
            @click="loadCollectors"
          >
            <refresh-cw :size="17" :stroke-width="1.8" />
          </el-button>
        </el-tooltip>

        <el-tooltip content="新建 Collector" placement="bottom">
          <el-button
            class="collector-create-button"
            type="primary"
            :icon="Plus"
            aria-label="新建 Collector"
            :disabled="!allowRemoteCollectors && hasLocalCollector"
            @click="openCreate"
          >
            新建
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
      />

      <section
        v-if="runtimeInfo?.kind === 'desktop'"
        class="desktop-runtime-bar"
        aria-label="Desktop Server 连接信息"
      >
        <div class="desktop-runtime-status">
          <span class="runtime-status-dot" aria-hidden="true"></span>
          <strong>Desktop Server</strong>
          <span>端口 {{ runtimeInfo.port }}</span>
        </div>
        <div class="desktop-runtime-values">
          <div v-for="url in runtimeInfo.urls" :key="url" class="runtime-value">
            <code>{{ url }}</code>
            <el-tooltip content="复制访问地址" placement="top">
              <el-button
                link
                aria-label="复制访问地址"
                @click="copyText(url, '访问地址已复制。')"
              >
                <copy :size="15" :stroke-width="1.8" />
              </el-button>
            </el-tooltip>
          </div>
        </div>
      </section>

      <section class="table-region collector-table-region" aria-label="Collector 列表">
        <!-- @vue-generic {ManagedCollectorInfo} -->
        <el-table
          v-loading="loading"
          :data="collectors"
          height="100%"
          row-key="id"
          table-layout="fixed"
          scrollbar-always-on
        >
          <el-table-column
            prop="name"
            label="名称"
            min-width="170"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              <span class="collector-name">{{ row.name }}</span>
            </template>
          </el-table-column>

          <el-table-column label="状态" width="92">
            <template #default="{ row }">
              <el-tag :type="row.online ? 'success' : 'info'" effect="plain" size="small">
                <check v-if="row.online" :size="12" />
                <x v-else :size="12" />
                {{ row.online ? "在线" : "离线" }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column label="类型" width="92">
            <template #default="{ row }">
              <span class="collector-type">
                <server :size="14" :stroke-width="1.8" />
                {{ row.connectionType === "local" ? "本机" : "远程" }}
              </span>
            </template>
          </el-table-column>

          <el-table-column
            prop="hostname"
            label="主机"
            min-width="150"
            show-overflow-tooltip
          >
            <template #default="{ row }">{{ row.hostname || "未知" }}</template>
          </el-table-column>

          <el-table-column label="Agent" width="110" show-overflow-tooltip>
            <template #default="{ row }">
              {{ formatAgents(asCollector(row)) }}
            </template>
          </el-table-column>

          <el-table-column
            prop="version"
            label="版本"
            width="105"
            show-overflow-tooltip
          >
            <template #default="{ row }">{{ row.version || "未知" }}</template>
          </el-table-column>

          <el-table-column label="最后活动" width="152">
            <template #default="{ row }">
              <el-tooltip :content="formatExactTime(row.lastSeenAt)" placement="top">
                <span class="updated-time">{{ formatLastActivity(row.lastSeenAt) }}</span>
              </el-tooltip>
            </template>
          </el-table-column>

          <el-table-column label="" width="198" fixed="right" align="right">
            <template #default="{ row }">
              <div class="collector-row-actions">
                <el-tooltip content="查看 Sessions" placement="top">
                  <el-button
                    link
                    aria-label="查看 Sessions"
                    @click="emit('view-sessions', row.id)"
                  >
                    <list :size="15" :stroke-width="1.8" />
                  </el-button>
                </el-tooltip>
                <el-tooltip content="立即同步" placement="top">
                  <el-button
                    link
                    :loading="syncingCollectorIds.has(row.id)"
                    aria-label="立即同步"
                    @click="syncCollector(asCollector(row))"
                  >
                    <refresh-cw
                      v-if="!syncingCollectorIds.has(row.id)"
                      :size="15"
                      :stroke-width="1.8"
                    />
                  </el-button>
                </el-tooltip>
                <el-tooltip content="修改名称" placement="top">
                  <el-button
                    link
                    aria-label="修改名称"
                    @click="openRename(asCollector(row))"
                  >
                    <pencil :size="15" :stroke-width="1.8" />
                  </el-button>
                </el-tooltip>
                <el-tooltip
                  v-if="row.connectionType === 'remote'"
                  content="查看 token"
                  placement="top"
                >
                  <el-button
                    link
                    :loading="tokenLoading"
                    aria-label="查看 token"
                    @click="showToken(asCollector(row))"
                  >
                    <key-round :size="15" :stroke-width="1.8" />
                  </el-button>
                </el-tooltip>
                <el-tooltip content="删除 Collector" placement="top">
                  <el-button
                    link
                    class="danger-action"
                    aria-label="删除 Collector"
                    @click="deleteCollector(asCollector(row))"
                  >
                    <Trash2 :size="15" :stroke-width="1.8" />
                  </el-button>
                </el-tooltip>
              </div>
            </template>
          </el-table-column>

          <template #empty>
            <el-empty :image-size="64" description="尚未配置 Collector" />
          </template>
        </el-table>
      </section>

      <el-dialog
        v-model="createDialog"
        title="新建 Collector"
        width="min(92vw, 440px)"
        :transition="dialogTransition"
        @closed="handleCreateClosed"
      >
        <el-form label-position="top" @submit.prevent="createCollector">
          <el-form-item label="类型">
            <el-radio-group v-model="createType" class="collector-type-choice">
              <el-radio-button value="local" :disabled="hasLocalCollector">
                本机
              </el-radio-button>
              <el-radio-button v-if="allowRemoteCollectors" value="remote">
                远程
              </el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="名称" required>
            <el-input
              v-model="createName"
              maxlength="128"
              show-word-limit
              placeholder="例如：开发机"
              autofocus
              @keyup.enter="createCollector"
            />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="createDialog = false">取消</el-button>
          <el-button
            type="primary"
            :loading="creating"
            :icon="Plus"
            @click="createCollector"
          >
            创建
          </el-button>
        </template>
      </el-dialog>

      <el-dialog
        v-model="renameDialog"
        title="修改 Collector 名称"
        width="min(92vw, 440px)"
        :transition="dialogTransition"
      >
        <el-input
          v-model="renameName"
          maxlength="128"
          show-word-limit
          autofocus
          @keyup.enter="renameCollector"
        />
        <template #footer>
          <el-button @click="renameDialog = false">取消</el-button>
          <el-button
            type="primary"
            :loading="renaming"
            :icon="Pencil"
            @click="renameCollector"
          >
            保存
          </el-button>
        </template>
      </el-dialog>

      <el-dialog
        v-model="tokenDialog"
        :title="tokenTitle"
        width="min(92vw, 560px)"
        :transition="dialogTransition"
      >
        <p class="token-dialog-note">
          请保存此 token，用于远程 Collector 连接 Server。
        </p>
        <div class="token-value-row">
          <el-input :model-value="tokenValue" readonly class="token-value-input" />
          <el-tooltip content="复制 token" placement="top">
            <el-button circle aria-label="复制 token" :icon="Copy" @click="copyToken" />
          </el-tooltip>
        </div>
        <template #footer>
          <el-button :icon="Clipboard" @click="copyToken">复制 token</el-button>
          <el-button type="primary" @click="tokenDialog = false">关闭</el-button>
        </template>
      </el-dialog>
    </main>
  </el-config-provider>
</template>
