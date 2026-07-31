import {
  createModels,
  getSupportedThinkingLevels,
  type Api,
  type Model,
  type Models,
} from "@earendil-works/pi-ai"
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic"
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai"
import {
  assertAiSettingsInput,
  type AiCatalog,
  type AiProviderId,
  type AiSettings,
  type AiSettingsInput,
  type AiThinkingLevel,
  type AiValidationResult,
} from "@nexume/contracts"
import type { SettingsStore, StoredAiSettings } from "@nexume/storage"

const validationTimeoutMs = 15_000
const exposedThinkingLevels = ["off", "low", "medium", "high", "max"] as const

export class AiSettingsError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "AiSettingsError"
  }
}

export interface AiSettingsServiceOptions {
  models?: Models
  completeSimple?: Models["completeSimple"]
}

function createBuiltinModels(): Models {
  const models = createModels()
  models.setProvider(openaiProvider())
  models.setProvider(anthropicProvider())
  return models
}

export class AiSettingsService {
  private readonly models: Models
  private readonly completeSimple: Models["completeSimple"]

  constructor(
    private readonly settings: SettingsStore,
    options: AiSettingsServiceOptions = {},
  ) {
    this.models = options.models ?? createBuiltinModels()
    this.completeSimple =
      options.completeSimple ?? this.models.completeSimple.bind(this.models)
  }

  getCatalog(): AiCatalog {
    return {
      providers: this.models.getProviders().map((provider) => ({
        id: provider.id as AiProviderId,
        name: provider.name,
        models: provider.getModels().map((model) => ({
          id: model.id,
          name: model.name,
          protocol: model.api,
          baseUrl: model.baseUrl,
          thinkingLevels: this.getThinkingLevels(model),
        })),
      })),
    }
  }

  get(): AiSettings | undefined {
    const stored = this.settings.get("ai.configuration")
    return stored
      ? {
          provider: stored.provider,
          model: stored.model,
          baseUrl: stored.baseUrl,
          thinkingLevel: stored.thinkingLevel,
          hasApiKey: Boolean(stored.apiKey),
        }
      : undefined
  }

  save(input: AiSettingsInput): AiSettings {
    const resolved = this.resolve(input)
    this.settings.set("ai.configuration", resolved)
    return {
      provider: resolved.provider,
      model: resolved.model,
      baseUrl: resolved.baseUrl,
      thinkingLevel: resolved.thinkingLevel,
      hasApiKey: true,
    }
  }

  async validate(input: AiSettingsInput): Promise<AiValidationResult> {
    const resolved = this.resolve(input)
    const model = this.requireModel(resolved.provider, resolved.model)
    const requestModel = { ...model, baseUrl: resolved.baseUrl }
    const startedAt = performance.now()
    const message = await this.completeSimple(
      requestModel,
      {
        messages: [
          {
            role: "user",
            content: "Reply with OK.",
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey: resolved.apiKey,
        cacheRetention: "none",
        maxRetries: 0,
        maxTokens: 16,
        signal: AbortSignal.timeout(validationTimeoutMs),
      },
    )

    if (message.stopReason === "aborted") {
      throw new AiSettingsError(
        "ai_validation_timeout",
        "AI 连接校验超时。",
        504,
      )
    }
    if (message.stopReason === "error") {
      const upstreamMessage = message.errorMessage?.replaceAll(
        resolved.apiKey,
        "[redacted]",
      )
      throw new AiSettingsError(
        "ai_validation_failed",
        upstreamMessage || "AI 连接校验失败。",
        502,
      )
    }

    return { latencyMs: Math.max(0, Math.round(performance.now() - startedAt)) }
  }

  private resolve(input: AiSettingsInput): StoredAiSettings {
    assertAiSettingsInput(input)
    const model = this.requireModel(input.provider, input.model.trim())
    const thinkingLevel = input.thinkingLevel
    if (!this.getThinkingLevels(model).includes(thinkingLevel)) {
      throw new AiSettingsError(
        "invalid_ai_settings",
        "所选模型不支持该思考强度。",
        400,
      )
    }

    const existing = this.settings.get("ai.configuration")
    const submittedKey = input.apiKey?.trim()
    const baseUrl = input.baseUrl.trim()
    const apiKey =
      submittedKey ||
      (existing?.provider === input.provider && existing.baseUrl === baseUrl
        ? existing.apiKey
        : undefined)
    if (!apiKey) {
      throw new AiSettingsError(
        "invalid_ai_settings",
        "请输入所选 Provider 的 API 密钥。",
        400,
      )
    }

    return {
      provider: input.provider,
      model: model.id,
      baseUrl,
      apiKey,
      thinkingLevel,
    }
  }

  private requireModel(provider: AiProviderId, modelId: string): Model<Api> {
    const model = this.models.getModel(provider, modelId)
    if (!model) {
      throw new AiSettingsError(
        "invalid_ai_settings",
        "所选 AI 模型不存在。",
        400,
      )
    }
    return model
  }

  private getThinkingLevels(model: Model<Api>): AiThinkingLevel[] {
    const supported = new Set(getSupportedThinkingLevels(model))
    return [
      null,
      ...exposedThinkingLevels.filter((level) => supported.has(level)),
    ]
  }
}
