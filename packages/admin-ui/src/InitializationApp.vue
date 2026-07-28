<script setup lang="ts">
import {
  ElButton,
  ElCheckbox,
  ElConfigProvider,
  ElInput,
} from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import { ArrowRight, KeyRound, LoaderCircle, RotateCw } from "lucide-vue-next";
import { onMounted, ref, watch } from "vue";

import type { InitializationClient } from "./client";

const props = withDefaults(
  defineProps<{
    client: InitializationClient;
    requiresAccessToken?: boolean;
    allowLocalCollectorChoice?: boolean;
    initialAccessToken?: string;
  }>(),
  {
    requiresAccessToken: false,
    allowLocalCollectorChoice: false,
    initialAccessToken: "",
  },
);

const emit = defineEmits<{
  initialized: [accessToken: string];
}>();

const checking = ref(true);
const statusAvailable = ref(false);
const submitting = ref(false);
const errorMessage = ref("");
const accessToken = ref(props.initialAccessToken);
const initializeLocalCollector = ref(true);

watch(
  () => props.initialAccessToken,
  (token) => {
    accessToken.value = token;
  },
);

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function checkStatus(): Promise<void> {
  checking.value = true;
  statusAvailable.value = false;
  errorMessage.value = "";

  try {
    const status = await props.client.getInitializationStatus();
    if (status.initialized) {
      emit("initialized", "");
      return;
    }
    statusAvailable.value = true;
  } catch (error) {
    errorMessage.value = errorText(error, "读取初始化状态失败。");
  } finally {
    checking.value = false;
  }
}

async function complete(): Promise<void> {
  const token = accessToken.value.trim();
  if (props.requiresAccessToken && !token) {
    errorMessage.value = "请输入访问令牌。";
    return;
  }

  submitting.value = true;
  errorMessage.value = "";

  try {
    await props.client.completeInitialization(
      { initializeLocalCollector: initializeLocalCollector.value },
      token || undefined,
    );
    emit("initialized", token);
  } catch (error) {
    errorMessage.value = errorText(error, "初始化 Nexume 失败。");
  } finally {
    submitting.value = false;
  }
}

onMounted(() => void checkStatus());
</script>

<template>
  <el-config-provider :locale="zhCn">
    <main class="initialization-shell">
      <section class="initialization-panel" aria-labelledby="initialization-title">
        <div class="initialization-brand" aria-hidden="true">N</div>

        <template v-if="checking">
          <loader-circle class="initialization-spinner" :size="24" />
          <p>正在检查本地数据</p>
        </template>

        <template v-else-if="!statusAvailable">
          <h1 id="initialization-title">Nexume</h1>
          <p>无法读取初始化状态</p>
          <div class="initialization-form">
            <span class="initialization-error" role="alert">
              {{ errorMessage }}
            </span>
            <el-button size="large" :icon="RotateCw" @click="checkStatus">
              重新检查
            </el-button>
          </div>
        </template>

        <template v-else>
          <h1 id="initialization-title">Nexume</h1>
          <p>完成首次初始化后即可开始使用</p>

          <form class="initialization-form" @submit.prevent="complete">
            <el-input
              v-if="requiresAccessToken && !initialAccessToken"
              v-model="accessToken"
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

            <el-checkbox
              v-if="allowLocalCollectorChoice"
              v-model="initializeLocalCollector"
              class="initialization-checkbox"
            >
              初始化本机 Collector
            </el-checkbox>

            <span v-if="errorMessage" class="initialization-error" role="alert">
              {{ errorMessage }}
            </span>

            <el-button
              type="primary"
              size="large"
              native-type="submit"
              :loading="submitting"
              :icon="ArrowRight"
            >
              开始使用
            </el-button>
          </form>
        </template>
      </section>
    </main>
  </el-config-provider>
</template>
