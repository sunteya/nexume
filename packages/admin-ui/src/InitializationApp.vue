<script setup lang="ts">
import {
  ElButton,
  ElCheckbox,
  ElInput,
} from "element-plus";
import { ArrowRight, KeyRound, LoaderCircle, RotateCw } from "lucide-vue-next";
import { onMounted, ref, watch } from "vue";

import type { InitializationClient } from "./client";
import AuthLayout from "./AuthLayout.vue";

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
    errorMessage.value = errorText(error, "Unable to read the setup status.");
  } finally {
    checking.value = false;
  }
}

async function complete(): Promise<void> {
  const token = accessToken.value.trim();
  if (props.requiresAccessToken && !token) {
    errorMessage.value = "Enter an access token.";
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
    errorMessage.value = errorText(error, "Unable to set up Nexume.");
  } finally {
    submitting.value = false;
  }
}

onMounted(() => void checkStatus());
</script>

<template>
  <auth-layout
    :title="checking ? undefined : statusAvailable ? 'Set up Nexume' : 'Setup unavailable'"
    :description="
      checking
        ? 'Checking local data...'
        : statusAvailable
          ? 'Complete the initial setup to start using Nexume.'
          : 'The local setup status could not be read.'
    "
    :busy="checking"
  >
    <template v-if="checking">
      <loader-circle class="initialization-spinner" :size="24" />
    </template>

    <template v-else-if="!statusAvailable">
      <div class="auth-form">
        <span class="auth-error" role="alert">
          {{ errorMessage }}
        </span>
        <el-button size="large" :icon="RotateCw" @click="checkStatus">
          Check again
        </el-button>
      </div>
    </template>

    <template v-else>
      <form class="auth-form" @submit.prevent="complete">
        <el-input
          v-if="requiresAccessToken && !initialAccessToken"
          v-model="accessToken"
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

        <el-checkbox
          v-if="allowLocalCollectorChoice"
          v-model="initializeLocalCollector"
          class="initialization-checkbox"
        >
          Create a local collector
        </el-checkbox>

        <span v-if="errorMessage" class="auth-error" role="alert">
          {{ errorMessage }}
        </span>

        <el-button
          type="primary"
          size="large"
          native-type="submit"
          :loading="submitting"
          :icon="ArrowRight"
        >
          Get started
        </el-button>
      </form>
    </template>
  </auth-layout>
</template>
