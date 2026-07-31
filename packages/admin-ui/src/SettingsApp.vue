<script setup lang="ts">
import type {
  AiModelInfo,
  AiProviderId,
  AiSettingsInput,
  AiThinkingLevel,
} from "@nexume/contracts"
import {
  ElAlert,
  ElButton,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
  ElOption,
  ElSelect,
} from "element-plus"
import { Cable, CircleCheck, Save } from "lucide-vue-next"
import { computed, onMounted, reactive, ref, watch } from "vue"

import type { AiSettingsClient } from "./client"
import PageToolbar from "./PageToolbar.vue"

type ThinkingSelection = "default" | Exclude<AiThinkingLevel, null>

const props = defineProps<{ client: AiSettingsClient }>()

const providers = ref<
  Awaited<ReturnType<AiSettingsClient["getCatalog"]>>["providers"]
>([])
const form = reactive({
  provider: "openai" as AiProviderId,
  model: "",
  baseUrl: "",
  apiKey: "",
  thinkingLevel: "default" as ThinkingSelection,
})
const loading = ref(true)
const saving = ref(false)
const validating = ref(false)
const validationSucceeded = ref(false)
const errorMessage = ref("")
const savedProvider = ref<AiProviderId>()
const savedBaseUrl = ref("")
const savedHasApiKey = ref(false)

const selectedProvider = computed(() =>
  providers.value.find((provider) => provider.id === form.provider),
)
const selectedModel = computed(() =>
  selectedProvider.value?.models.find((model) => model.id === form.model),
)
const hasReusableApiKey = computed(
  () =>
    savedHasApiKey.value &&
    savedProvider.value === form.provider &&
    savedBaseUrl.value === form.baseUrl.trim(),
)
const thinkingOptions = computed(() =>
  (selectedModel.value?.thinkingLevels ?? [null]).map((level) => ({
    value: level === null ? ("default" as const) : level,
    label:
      level === null
        ? "Default"
        : level === "off"
          ? "Off"
          : level[0].toUpperCase() + level.slice(1),
  })),
)
const formReady = computed(
  () =>
    Boolean(form.provider && form.model && form.baseUrl.trim()) &&
    Boolean(form.apiKey.trim() || hasReusableApiKey.value),
)

watch(
  () => [
    form.provider,
    form.model,
    form.baseUrl,
    form.apiKey,
    form.thinkingLevel,
  ],
  () => {
    validationSucceeded.value = false
  },
)

function selectProvider(): void {
  form.model = ""
  form.baseUrl = ""
  form.apiKey = ""
  form.thinkingLevel = "default"
  errorMessage.value = ""
}

function selectModel(modelId: string): void {
  const model = selectedProvider.value?.models.find(
    (candidate) => candidate.id === modelId,
  )
  form.baseUrl = model?.baseUrl ?? ""
  form.thinkingLevel = "default"
  errorMessage.value = ""
}

function toInput(): AiSettingsInput {
  return {
    provider: form.provider,
    model: form.model,
    baseUrl: form.baseUrl.trim(),
    apiKey: form.apiKey.trim() || undefined,
    thinkingLevel: form.thinkingLevel === "default" ? null : form.thinkingLevel,
  }
}

async function load(): Promise<void> {
  loading.value = true
  errorMessage.value = ""
  try {
    const [catalog, settings] = await Promise.all([
      props.client.getCatalog(),
      props.client.getSettings(),
    ])
    providers.value = catalog.providers
    if (settings) {
      form.provider = settings.provider
      form.model = settings.model
      form.baseUrl = settings.baseUrl
      form.thinkingLevel = settings.thinkingLevel ?? "default"
      savedProvider.value = settings.provider
      savedBaseUrl.value = settings.baseUrl
      savedHasApiKey.value = settings.hasApiKey
    } else if (catalog.providers[0]) {
      form.provider = catalog.providers[0].id
    }
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to load AI settings."
  } finally {
    loading.value = false
  }
}

async function saveSettings(): Promise<void> {
  if (!formReady.value || saving.value) return
  saving.value = true
  errorMessage.value = ""
  try {
    const settings = await props.client.save(toInput())
    savedProvider.value = settings.provider
    savedBaseUrl.value = settings.baseUrl
    savedHasApiKey.value = settings.hasApiKey
    form.apiKey = ""
    ElMessage.success("AI settings saved.")
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to save AI settings."
  } finally {
    saving.value = false
  }
}

async function validateSettings(): Promise<void> {
  if (!formReady.value || validating.value) return
  validating.value = true
  validationSucceeded.value = false
  errorMessage.value = ""
  try {
    const result = await props.client.validate(toInput())
    validationSucceeded.value = true
    ElMessage.success(`Connection verified in ${result.latencyMs} ms.`)
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to validate AI settings."
  } finally {
    validating.value = false
  }
}

function modelLabel(model: AiModelInfo): string {
  return model.name === model.id ? model.name : `${model.name} (${model.id})`
}

onMounted(load)
</script>

<template>
  <section class="app-view settings-view">
    <page-toolbar title="AI Settings" summary="OpenAI and Anthropic" />

    <div class="settings-region" v-loading="loading">
      <el-form
        class="settings-form"
        label-position="top"
        @submit.prevent="saveSettings"
      >
        <el-alert
          v-if="errorMessage"
          class="settings-alert"
          type="error"
          :title="errorMessage"
          show-icon
          :closable="false"
        />

        <div class="settings-section">
          <h2>Model</h2>
          <div class="settings-field-grid">
            <el-form-item label="Provider" required>
              <el-select v-model="form.provider" @change="selectProvider">
                <el-option
                  v-for="provider in providers"
                  :key="provider.id"
                  :label="provider.name"
                  :value="provider.id"
                />
              </el-select>
            </el-form-item>

            <el-form-item label="Model" required>
              <el-select
                v-model="form.model"
                filterable
                placeholder="Select a model"
                @change="selectModel"
              >
                <el-option
                  v-for="model in selectedProvider?.models ?? []"
                  :key="model.id"
                  :label="modelLabel(model)"
                  :value="model.id"
                />
              </el-select>
            </el-form-item>
          </div>

          <el-form-item label="Thinking">
            <el-select v-model="form.thinkingLevel">
              <el-option
                v-for="option in thinkingOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
          </el-form-item>
        </div>

        <div class="settings-section">
          <h2>Connection</h2>
          <el-form-item label="API address" required>
            <el-input
              v-model="form.baseUrl"
              placeholder="https://api.example.com/v1"
              spellcheck="false"
            />
          </el-form-item>

          <el-form-item label="API key" required>
            <el-input
              v-model="form.apiKey"
              type="password"
              show-password
              autocomplete="new-password"
              :placeholder="
                hasReusableApiKey ? 'Saved - leave blank to keep' : 'API key'
              "
            />
          </el-form-item>
        </div>

        <div class="settings-actions">
          <el-button
            class="settings-test-button"
            :class="{
              'is-validating': validating,
              'is-validated': validationSucceeded,
            }"
            :disabled="!formReady"
            :loading="validating"
            @click="validateSettings"
          >
            <circle-check
              v-if="validationSucceeded"
              :size="16"
              :stroke-width="1.8"
            />
            <cable v-else-if="!validating" :size="16" :stroke-width="1.8" />
            {{
              validationSucceeded ? "Connection verified" : "Test connection"
            }}
          </el-button>
          <el-button
            type="primary"
            native-type="submit"
            :disabled="!formReady"
            :loading="saving"
          >
            <save :size="16" :stroke-width="1.8" />
            Save
          </el-button>
        </div>
      </el-form>
    </div>
  </section>
</template>
