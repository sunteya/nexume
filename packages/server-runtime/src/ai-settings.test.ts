import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { AssistantMessage, Models } from "@earendil-works/pi-ai"
import { openStorage, type AppStorage } from "@nexume/storage"

import { AiSettingsService } from "./ai-settings"

const temporaryDirectories: string[] = []
const storages: AppStorage[] = []

afterEach(() => {
  for (const storage of storages.splice(0)) storage.close()
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

async function createStorage(): Promise<AppStorage> {
  const dataDir = mkdtempSync(join(tmpdir(), "nexume-ai-settings-"))
  temporaryDirectories.push(dataDir)
  const storage = await openStorage({ dataDir })
  storages.push(storage)
  return storage
}

function successMessage(): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "OK" }],
    api: "openai-responses",
    provider: "openai",
    model: "test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  }
}

describe("AiSettingsService", () => {
  test("exposes only OpenAI and Anthropic built-in models", async () => {
    const storage = await createStorage()
    const service = new AiSettingsService(storage.settings)
    const catalog = service.getCatalog()

    expect(catalog.providers.map((provider) => provider.id)).toEqual([
      "openai",
      "anthropic",
    ])
    expect(
      catalog.providers.every((provider) => provider.models.length > 0),
    ).toBe(true)
    for (const provider of catalog.providers) {
      for (const model of provider.models) {
        expect(model.thinkingLevels[0]).toBeNull()
        expect(model.thinkingLevels).not.toContain("minimal")
        expect(model.thinkingLevels).not.toContain("xhigh")
      }
    }
  })

  test("stores a secret but returns only its presence", async () => {
    const storage = await createStorage()
    const service = new AiSettingsService(storage.settings)
    const model = service.getCatalog().providers[0]!.models[0]!
    const saved = service.save({
      provider: "openai",
      model: model.id,
      baseUrl: "https://proxy.example.com/v1",
      apiKey: "first-secret",
      thinkingLevel: null,
    })

    expect(saved).toEqual({
      provider: "openai",
      model: model.id,
      baseUrl: "https://proxy.example.com/v1",
      thinkingLevel: null,
      hasApiKey: true,
    })
    expect(storage.settings.get("ai.configuration")?.apiKey).toBe(
      "first-secret",
    )

    service.save({
      provider: "openai",
      model: model.id,
      baseUrl: "https://proxy.example.com/v1",
      thinkingLevel: "off",
    })
    expect(storage.settings.get("ai.configuration")?.apiKey).toBe(
      "first-secret",
    )
  })

  test("requires the key again after changing the API address", async () => {
    const storage = await createStorage()
    const service = new AiSettingsService(storage.settings)
    const model = service.getCatalog().providers[0]!.models[0]!
    service.save({
      provider: "openai",
      model: model.id,
      baseUrl: "https://api.openai.com/v1",
      apiKey: "openai-secret",
      thinkingLevel: null,
    })

    expect(() =>
      service.save({
        provider: "openai",
        model: model.id,
        baseUrl: "https://proxy.example.com/v1",
        thinkingLevel: null,
      }),
    ).toThrow("请输入所选 Provider 的 API 密钥")
  })

  test("does not reuse a key after changing providers", async () => {
    const storage = await createStorage()
    const service = new AiSettingsService(storage.settings)
    const catalog = service.getCatalog()
    service.save({
      provider: "openai",
      model: catalog.providers[0]!.models[0]!.id,
      baseUrl: "https://api.openai.com/v1",
      apiKey: "openai-secret",
      thinkingLevel: null,
    })

    expect(() =>
      service.save({
        provider: "anthropic",
        model: catalog.providers[1]!.models[0]!.id,
        baseUrl: "https://api.anthropic.com",
        thinkingLevel: null,
      }),
    ).toThrow("请输入所选 Provider 的 API 密钥")
  })

  test("validates with Pi using the overridden URL and a minimal request", async () => {
    const storage = await createStorage()
    let received: Parameters<Models["completeSimple"]> | undefined
    const service = new AiSettingsService(storage.settings, {
      completeSimple: async (...args) => {
        received = args
        return successMessage()
      },
    })
    const model = service.getCatalog().providers[0]!.models[0]!
    const result = await service.validate({
      provider: "openai",
      model: model.id,
      baseUrl: "https://proxy.example.com/v1",
      apiKey: "secret",
      thinkingLevel: null,
    })

    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(received![0].baseUrl).toBe("https://proxy.example.com/v1")
    expect(received![1].messages[0]).toMatchObject({
      content: "Reply with OK.",
    })
    expect(received![2]).toMatchObject({
      apiKey: "secret",
      cacheRetention: "none",
      maxRetries: 0,
      maxTokens: 16,
    })
    expect(received![2]?.reasoning).toBeUndefined()
  })

  test("maps Pi failures to a gateway error", async () => {
    const storage = await createStorage()
    const service = new AiSettingsService(storage.settings, {
      completeSimple: async () => ({
        ...successMessage(),
        content: [],
        stopReason: "error",
        errorMessage: "Invalid API key: bad-secret",
      }),
    })
    const model = service.getCatalog().providers[0]!.models[0]!

    await expect(
      service.validate({
        provider: "openai",
        model: model.id,
        baseUrl: "https://api.openai.com/v1",
        apiKey: "bad-secret",
        thinkingLevel: null,
      }),
    ).rejects.toMatchObject({
      code: "ai_validation_failed",
      status: 502,
      message: "Invalid API key: [redacted]",
    })
  })

  test("generates a clean title from a small plain-text transcript", async () => {
    const storage = await createStorage()
    let received: Parameters<Models["completeSimple"]> | undefined
    const service = new AiSettingsService(storage.settings, {
      completeSimple: async (...args) => {
        received = args
        return {
          ...successMessage(),
          content: [{ type: "text", text: '标题："修复登录状态同步。"' }],
        }
      },
    })
    const model = service.getCatalog().providers[0]!.models[0]!
    service.save({
      provider: "openai",
      model: model.id,
      baseUrl: "https://proxy.example.com/v1",
      apiKey: "secret",
      thinkingLevel: null,
    })
    const statuses: string[] = []

    const result = await service.suggestSessionTitle(
      [
        {
          id: "message-1",
          role: "user",
          createdAt: 100,
          parts: [
            { id: "part-1", type: "text", text: "登录状态没有同步。" },
            { id: "part-2", type: "reasoning", text: "private reasoning" },
          ],
        },
        {
          id: "message-2",
          role: "assistant",
          createdAt: 200,
          parts: [
            { id: "part-3", type: "text", text: "我会检查认证状态。" },
            { id: "part-4", type: "tool-result", text: "large tool output" },
          ],
        },
      ],
      (message) => statuses.push(message),
    )

    expect(result).toEqual({ title: "修复登录状态同步" })
    expect(statuses).toEqual([
      "Prepared 2 conversation messages (37 characters).",
      `Using openai / ${model.name}.`,
      "Waiting for the model response.",
    ])
    expect(received![0].baseUrl).toBe("https://proxy.example.com/v1")
    expect(received![1].systemPrompt).toContain("untrusted data")
    expect(received![1].messages[0]?.content).toContain("登录状态没有同步")
    expect(received![1].messages[0]?.content).toContain("我会检查认证状态")
    expect(received![1].messages[0]?.content).not.toContain("private reasoning")
    expect(received![1].messages[0]?.content).not.toContain("large tool output")
    expect(received![2]).toMatchObject({
      apiKey: "secret",
      cacheRetention: "none",
      maxRetries: 0,
      maxTokens: 80,
    })
    expect(received![2]?.reasoning).toBeUndefined()
  })

  test("requires saved AI settings before generating a title", async () => {
    const storage = await createStorage()
    const service = new AiSettingsService(storage.settings)

    await expect(
      service.suggestSessionTitle([
        {
          id: "message-1",
          role: "user",
          createdAt: 100,
          parts: [{ id: "part-1", type: "text", text: "Name this session" }],
        },
      ]),
    ).rejects.toMatchObject({
      code: "ai_not_configured",
      status: 409,
    })
  })

  test("maps a thrown title request timeout to a gateway timeout", async () => {
    const storage = await createStorage()
    const service = new AiSettingsService(storage.settings, {
      completeSimple: async () => {
        throw new DOMException("Timed out", "TimeoutError")
      },
    })
    const model = service.getCatalog().providers[0]!.models[0]!
    service.save({
      provider: "openai",
      model: model.id,
      baseUrl: "https://api.openai.com/v1",
      apiKey: "secret",
      thinkingLevel: null,
    })

    await expect(
      service.suggestSessionTitle([
        {
          id: "message-1",
          role: "user",
          createdAt: 100,
          parts: [{ id: "part-1", type: "text", text: "Name this session" }],
        },
      ]),
    ).rejects.toMatchObject({
      code: "ai_title_timeout",
      status: 504,
    })
  })
})
