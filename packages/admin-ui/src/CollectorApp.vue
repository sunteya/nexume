<script setup lang="ts">
import {
  ElAlert,
  ElButton,
  ElDialog,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
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
import {
  Check,
  Clipboard,
  Copy,
  KeyRound,
  List,
  Ellipsis,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-vue-next";
import { computed, onActivated, onMounted, onUnmounted, ref } from "vue";

import type {
  CollectorConnectionType,
  CreateCollectorInput,
  ManagedCollectorInfo,
} from "@nexume/contracts";

import type { CollectorClient } from "./client";
import PageToolbar from "./PageToolbar.vue";

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
const compactActionsMedia = window.matchMedia("(max-width: 520px)");
const compactActions = ref(compactActionsMedia.matches);
let initialActivation = true;

const hasLocalCollector = computed(() =>
  collectors.value.some((collector) => collector.connectionType === "local"),
);
const onlineCount = computed(
  () => collectors.value.filter((collector) => collector.online).length,
);
const collectorSummary = computed(
  () => `${collectors.value.length} total / ${onlineCount.value} online`,
);
const relativeTimeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function asCollector(value: unknown): ManagedCollectorInfo {
  return value as ManagedCollectorInfo;
}

function formatAgents(collector: ManagedCollectorInfo): string {
  return collector.agents.length > 0 ? collector.agents.join(", ") : "Unknown";
}

function formatLastActivity(timestamp: number | undefined): string {
  if (!timestamp) return "Never connected";
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

function formatExactTime(timestamp: number | undefined): string {
  if (!timestamp) return "Never connected";
  const parts = Object.fromEntries(
    dateFormatter
      .formatToParts(new Date(timestamp))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

async function loadCollectors(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  errorMessage.value = "";
  try {
    collectors.value = await props.client.list();
  } catch (error) {
    errorMessage.value = errorText(error, "Unable to load collectors.");
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
    ElMessage.error("Enter a collector name.");
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
    ].sort((left, right) => left.name.localeCompare(right.name, "en"));

    if (result.token) {
      tokenTitle.value = `${result.collector.name} connection token`;
      tokenValue.value = result.token;
      showTokenAfterCreate.value = true;
    } else {
      ElMessage.success("Collector created.");
    }
  } catch (error) {
    ElMessage.error(errorText(error, "Unable to create the collector."));
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
    ElMessage.error("Enter a collector name.");
    return;
  }

  renaming.value = true;
  try {
    const updated = await props.client.rename(renameId.value, { name });
    const index = collectors.value.findIndex((collector) => collector.id === updated.id);
    if (index >= 0) collectors.value[index] = updated;
    renameDialog.value = false;
    ElMessage.success("Collector name updated.");
  } catch (error) {
    ElMessage.error(errorText(error, "Unable to rename the collector."));
  } finally {
    renaming.value = false;
  }
}

async function deleteCollector(collector: ManagedCollectorInfo): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `Delete collector "${collector.name}"? Its connection details and cached sessions will be removed.`,
      "Delete collector",
      {
        type: "warning",
        confirmButtonText: "Delete",
        cancelButtonText: "Cancel",
      },
    );
  } catch {
    return;
  }

  try {
    await props.client.delete(collector.id);
    collectors.value = collectors.value.filter((item) => item.id !== collector.id);
    ElMessage.success("Collector deleted.");
  } catch (error) {
    ElMessage.error(errorText(error, "Unable to delete the collector."));
  }
}

async function showToken(collector: ManagedCollectorInfo): Promise<void> {
  tokenLoading.value = true;
  try {
    const result = await props.client.getToken(collector.id);
    tokenTitle.value = `${collector.name} connection token`;
    tokenValue.value = result.token;
    tokenDialog.value = true;
  } catch (error) {
    ElMessage.error(errorText(error, "Unable to load the collector token."));
  } finally {
    tokenLoading.value = false;
  }
}

async function syncCollector(collector: ManagedCollectorInfo): Promise<void> {
  syncingCollectorIds.value = new Set(syncingCollectorIds.value).add(collector.id);
  try {
    await props.client.sync(collector.id);
    ElMessage.success(`Sync requested for ${collector.name}.`);
  } catch (error) {
    ElMessage.error(errorText(error, "Unable to start collector sync."));
  } finally {
    const next = new Set(syncingCollectorIds.value);
    next.delete(collector.id);
    syncingCollectorIds.value = next;
  }
}

async function copyToken(): Promise<void> {
  await copyText(tokenValue.value, "Token copied.");
}

async function copyText(value: string, success: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    ElMessage.success(success);
  } catch {
    ElMessage.error("Copy failed. Copy the token manually.");
  }
}

function syncCompactActions(event: MediaQueryListEvent): void {
  compactActions.value = event.matches;
}

onMounted(() => {
  compactActionsMedia.addEventListener("change", syncCompactActions);
  void loadCollectors();
});

onActivated(() => {
  if (initialActivation) {
    initialActivation = false;
    return;
  }
  void loadCollectors();
});

onUnmounted(() => {
  compactActionsMedia.removeEventListener("change", syncCompactActions);
});
</script>

<template>
  <section class="app-view collector-view">
    <page-toolbar title="Collectors" :summary="collectorSummary">
      <template #actions>
        <el-tooltip content="Refresh collectors" placement="bottom">
          <el-button
            class="refresh-button"
            circle
            :loading="loading"
            aria-label="Refresh collectors"
            @click="loadCollectors"
          >
            <refresh-cw :size="17" :stroke-width="1.8" />
          </el-button>
        </el-tooltip>

        <el-tooltip content="New collector" placement="bottom">
          <el-button
            class="collector-create-button"
            type="primary"
            :icon="Plus"
            aria-label="New collector"
            :disabled="!allowRemoteCollectors && hasLocalCollector"
            @click="openCreate"
          >
            New collector
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
      />

      <section class="table-region collector-table-region" aria-label="Collector list">
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
            label="Name"
            min-width="170"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              <span class="collector-name">{{ row.name }}</span>
            </template>
          </el-table-column>

          <el-table-column label="Status" width="96">
            <template #default="{ row }">
              <el-tag :type="row.online ? 'success' : 'info'" effect="plain" size="small">
                <check v-if="row.online" :size="12" />
                <x v-else :size="12" />
                {{ row.online ? "Online" : "Offline" }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column label="Type" width="96">
            <template #default="{ row }">
              <span class="collector-type">
                <server :size="14" :stroke-width="1.8" />
                {{ row.connectionType === "local" ? "Local" : "Remote" }}
              </span>
            </template>
          </el-table-column>

          <el-table-column
            prop="hostname"
            label="Host"
            min-width="150"
            show-overflow-tooltip
          >
            <template #default="{ row }">{{ row.hostname || "Unknown" }}</template>
          </el-table-column>

          <el-table-column label="Agent" width="110" show-overflow-tooltip>
            <template #default="{ row }">
              {{ formatAgents(asCollector(row)) }}
            </template>
          </el-table-column>

          <el-table-column
            prop="version"
            label="Version"
            width="105"
            show-overflow-tooltip
          >
            <template #default="{ row }">{{ row.version || "Unknown" }}</template>
          </el-table-column>

          <el-table-column label="Last active" width="152">
            <template #default="{ row }">
              <el-tooltip :content="formatExactTime(row.lastSeenAt)" placement="top">
                <span class="updated-time">{{ formatLastActivity(row.lastSeenAt) }}</span>
              </el-tooltip>
            </template>
          </el-table-column>

          <el-table-column
            label=""
            :width="compactActions ? 52 : 184"
            fixed="right"
            align="right"
          >
            <template #default="{ row }">
              <div v-if="!compactActions" class="collector-row-actions">
                <el-tooltip content="View sessions" placement="top">
                  <el-button
                    link
                    aria-label="View sessions"
                    @click="emit('view-sessions', row.id)"
                  >
                    <list :size="15" :stroke-width="1.8" />
                  </el-button>
                </el-tooltip>
                <el-tooltip content="Sync now" placement="top">
                  <el-button
                    link
                    :loading="syncingCollectorIds.has(row.id)"
                    aria-label="Sync now"
                    @click="syncCollector(asCollector(row))"
                  >
                    <refresh-cw
                      v-if="!syncingCollectorIds.has(row.id)"
                      :size="15"
                      :stroke-width="1.8"
                    />
                  </el-button>
                </el-tooltip>
                <el-tooltip content="Rename" placement="top">
                  <el-button
                    link
                    aria-label="Rename collector"
                    @click="openRename(asCollector(row))"
                  >
                    <pencil :size="15" :stroke-width="1.8" />
                  </el-button>
                </el-tooltip>
                <el-tooltip
                  v-if="row.connectionType === 'remote'"
                  content="View token"
                  placement="top"
                >
                  <el-button
                    link
                    :loading="tokenLoading"
                    aria-label="View token"
                    @click="showToken(asCollector(row))"
                  >
                    <key-round :size="15" :stroke-width="1.8" />
                  </el-button>
                </el-tooltip>
                <el-tooltip content="Delete collector" placement="top">
                  <el-button
                    link
                    class="danger-action"
                    aria-label="Delete collector"
                    @click="deleteCollector(asCollector(row))"
                  >
                    <Trash2 :size="15" :stroke-width="1.8" />
                  </el-button>
                </el-tooltip>
              </div>

              <el-dropdown v-else trigger="click" placement="bottom-end">
                <el-button link class="collector-overflow-button" aria-label="Collector actions">
                  <ellipsis :size="17" :stroke-width="1.8" />
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item :icon="List" @click="emit('view-sessions', row.id)">
                      View sessions
                    </el-dropdown-item>
                    <el-dropdown-item
                      :icon="RefreshCw"
                      :disabled="syncingCollectorIds.has(row.id)"
                      @click="syncCollector(asCollector(row))"
                    >
                      {{ syncingCollectorIds.has(row.id) ? "Syncing..." : "Sync now" }}
                    </el-dropdown-item>
                    <el-dropdown-item :icon="Pencil" @click="openRename(asCollector(row))">
                      Rename
                    </el-dropdown-item>
                    <el-dropdown-item
                      v-if="row.connectionType === 'remote'"
                      :icon="KeyRound"
                      @click="showToken(asCollector(row))"
                    >
                      View token
                    </el-dropdown-item>
                    <el-dropdown-item
                      :icon="Trash2"
                      divided
                      class="danger-dropdown-item"
                      @click="deleteCollector(asCollector(row))"
                    >
                      Delete
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </template>
          </el-table-column>

          <template #empty>
            <el-empty :image-size="64" description="No collectors configured" />
          </template>
        </el-table>
      </section>

      <el-dialog
        v-model="createDialog"
        title="New collector"
        width="min(92vw, 440px)"
        :transition="dialogTransition"
        @closed="handleCreateClosed"
      >
        <el-form label-position="top" @submit.prevent="createCollector">
          <el-form-item label="Type">
            <el-radio-group v-model="createType" class="collector-type-choice">
              <el-radio-button value="local" :disabled="hasLocalCollector">
                Local
              </el-radio-button>
              <el-radio-button v-if="allowRemoteCollectors" value="remote">
                Remote
              </el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="Name" required>
            <el-input
              v-model="createName"
              maxlength="128"
              show-word-limit
              placeholder="For example, Development Mac"
              autofocus
              @keyup.enter="createCollector"
            />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="createDialog = false">Cancel</el-button>
          <el-button
            type="primary"
            :loading="creating"
            :icon="Plus"
            @click="createCollector"
          >
            Create
          </el-button>
        </template>
      </el-dialog>

      <el-dialog
        v-model="renameDialog"
        title="Rename collector"
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
          <el-button @click="renameDialog = false">Cancel</el-button>
          <el-button
            type="primary"
            :loading="renaming"
            :icon="Pencil"
            @click="renameCollector"
          >
            Save
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
          Save this token. It is required to connect a remote collector to the Server.
        </p>
        <div class="token-value-row">
          <el-input :model-value="tokenValue" readonly class="token-value-input" />
          <el-tooltip content="Copy token" placement="top">
            <el-button circle aria-label="Copy token" :icon="Copy" @click="copyToken" />
          </el-tooltip>
        </div>
        <template #footer>
          <el-button :icon="Clipboard" @click="copyToken">Copy token</el-button>
          <el-button type="primary" @click="tokenDialog = false">Close</el-button>
        </template>
      </el-dialog>
  </section>
</template>
