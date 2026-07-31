import { timingSafeEqual } from "node:crypto"
import { resolve, sep } from "node:path"

import {
  assertCollectorName,
  assertAiSettingsInput,
  assertCreateCollectorInput,
  assertGetSessionDetailRequest,
  assertListSessionsParams,
  assertProjectInput,
  assertUpdateSessionTitleRequest,
  type AvailableSessionDirectory,
  type AiCatalog,
  type AiSettings,
  type AiSettingsInput,
  type AiValidationResult,
  type CreateCollectorInput,
  type CreateCollectorResult,
  type CreateProjectInput,
  type GetSessionDetailRequest,
  type InitializationStatus,
  type ListSessionsParams,
  type ManagedCollectorInfo,
  type ProjectInfo,
  type RuntimeInfo,
  type SessionBatchSize,
  type SessionDetailPage,
  type SessionDetailPageSize,
  type SessionStatus,
  type SessionSummary,
  type SessionTitleSuggestion,
  type SessionTitleSuggestionEvent,
  type UpdateSessionTitleRequest,
} from "@nexume/contracts"
import { InvalidSessionCursorError, type ServerCore } from "@nexume/server-core"
import { AlreadyInitializedError } from "@nexume/storage"

import { CollectorManagementError } from "./collector-management"
import { AiSettingsError } from "./ai-settings"
import { ProjectManagementError } from "./project-management"
import { SessionManagementError } from "./session-management"

interface ErrorBody {
  error: {
    code: string
    message: string
  }
}

export interface RequestHandlerOptions {
  accessToken: string
  core: ServerCore
  initialization?: {
    getStatus(): InitializationStatus
    complete(initializeLocalCollector: boolean): InitializationStatus
  }
  collectors?: {
    list(): ManagedCollectorInfo[]
    create(input: CreateCollectorInput): CreateCollectorResult
    rename(id: string, name: string): ManagedCollectorInfo
    delete(id: string): void
    revealToken(id: string): string
    sync(id: string): void
  }
  projects?: {
    list(): ProjectInfo[]
    create(input: CreateProjectInput): ProjectInfo
    update(id: string, input: CreateProjectInput): ProjectInfo
    delete(id: string): void
    listDirectories(): AvailableSessionDirectory[]
  }
  sessions?: {
    getDetail(
      collectorId: string,
      request: GetSessionDetailRequest,
    ): Promise<SessionDetailPage>
    updateTitle(
      collectorId: string,
      request: UpdateSessionTitleRequest,
    ): Promise<SessionSummary>
  }
  aiSettings?: {
    getCatalog(): AiCatalog
    get(): AiSettings | undefined
    save(input: AiSettingsInput): AiSettings
    validate(input: AiSettingsInput): Promise<AiValidationResult>
    suggestSessionTitle?(
      messages: SessionDetailPage["items"],
      onStatus?: (message: string) => void,
    ): Promise<SessionTitleSuggestion>
  }
  getRuntimeInfo?: () => RuntimeInfo
  webRoot?: string
  onError?: (error: unknown) => void
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

function sensitiveJson(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

function jsonLineStream(
  run: (send: (event: SessionTitleSuggestionEvent) => void) => Promise<void>,
): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        try {
          await run((event) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
          })
          controller.close()
        } catch (error) {
          controller.error(error)
        }
      })()
    },
  })
  return new Response(body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/x-ndjson; charset=utf-8",
    },
  })
}

function errorResponse(
  code: string,
  message: string,
  status: number,
): Response {
  return json({ error: { code, message } } satisfies ErrorBody, status)
}

function hasValidToken(request: Request, expectedToken: string): boolean {
  const authorization = request.headers.get("authorization")
  if (!authorization?.startsWith("Bearer ")) return false

  const encoder = new TextEncoder()
  const actual = encoder.encode(authorization.slice(7))
  const expected = encoder.encode(expectedToken)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function parseSessionParams(url: URL): ListSessionsParams {
  const limitValue = url.searchParams.get("limit")
  const cursor = url.searchParams.get("cursor") ?? undefined
  const collectorId = url.searchParams.get("collectorId") ?? undefined
  const projectId = url.searchParams.get("projectId") ?? undefined
  const unassignedValue = url.searchParams.get("unassigned")
  const agent = url.searchParams.get("agent") ?? undefined
  const title = url.searchParams.get("title") ?? undefined
  const status = (url.searchParams.get("status") ?? undefined) as
    SessionStatus | undefined
  const params = {
    limit: (limitValue === null ? 50 : Number(limitValue)) as SessionBatchSize,
    cursor,
    collectorId,
    projectId,
    unassigned:
      unassignedValue === null
        ? undefined
        : unassignedValue === "true"
          ? true
          : (unassignedValue as unknown as boolean),
    agent,
    title,
    status,
  }

  assertListSessionsParams(params)
  return params
}

async function parseJsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  const text = await request.text()
  if (text.length > 65_536) throw new Error("The request body is too large.")
  if (!text) return {}
  const value = JSON.parse(text) as unknown
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The request body must be a JSON object.")
  }
  return value as Record<string, unknown>
}

async function serveWebFile(webRoot: string, url: URL): Promise<Response> {
  let pathname: string

  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return new Response("Bad Request", { status: 400 })
  }

  const root = resolve(webRoot)
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1)
  const requestedPath = resolve(root, relativePath)

  if (requestedPath !== root && !requestedPath.startsWith(`${root}${sep}`)) {
    return new Response("Not Found", { status: 404 })
  }

  const requestedFile = Bun.file(requestedPath)
  if (await requestedFile.exists()) {
    return new Response(requestedFile, {
      headers: {
        "Cache-Control":
          relativePath === "index.html"
            ? "no-cache"
            : relativePath.startsWith("assets/")
              ? "public, max-age=31536000, immutable"
              : "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    })
  }

  if (relativePath.startsWith("assets/")) {
    return new Response("Not Found", { status: 404 })
  }

  const indexFile = Bun.file(resolve(root, "index.html"))
  if (await indexFile.exists()) return new Response(indexFile)

  return new Response("Nexume Web UI has not been built.", { status: 503 })
}

export function createRequestHandler(options: RequestHandlerOptions) {
  return async function handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({ status: "ok" })
    }

    if (request.method === "GET" && url.pathname === "/api/setup/status") {
      return json(options.initialization?.getStatus() ?? { initialized: true })
    }

    if (url.pathname.startsWith("/api/")) {
      if (!hasValidToken(request, options.accessToken)) {
        return errorResponse(
          "unauthorized",
          "The access token is missing or invalid.",
          401,
        )
      }

      if (request.method === "POST" && url.pathname === "/api/setup/complete") {
        if (!options.initialization) {
          return errorResponse(
            "not_found",
            "The API endpoint does not exist.",
            404,
          )
        }

        if (options.initialization.getStatus().initialized) {
          return errorResponse(
            "already_initialized",
            "Nexume has already been set up.",
            409,
          )
        }

        let initializeLocalCollector: boolean
        try {
          const body = await parseJsonBody(request)
          const value =
            body.initializeLocalCollector === undefined
              ? true
              : body.initializeLocalCollector
          if (typeof value !== "boolean") {
            throw new Error("initializeLocalCollector must be a boolean.")
          }
          initializeLocalCollector = value
        } catch (error) {
          const message =
            error instanceof SyntaxError
              ? "The request body is not valid JSON."
              : error instanceof Error
                ? error.message
                : "The request is invalid."
          return errorResponse("invalid_request", message, 400)
        }

        try {
          const status = options.initialization.complete(
            initializeLocalCollector,
          )
          return json(status)
        } catch (error) {
          if (error instanceof AlreadyInitializedError) {
            return errorResponse(
              "already_initialized",
              "Nexume has already been set up.",
              409,
            )
          }
          options.onError?.(error)
          return errorResponse(
            "internal_error",
            "Unable to set up Nexume.",
            500,
          )
        }
      }

      if (
        options.initialization &&
        !options.initialization.getStatus().initialized
      ) {
        return errorResponse(
          "setup_required",
          "Complete the Nexume setup before using this API.",
          428,
        )
      }

      if (request.method === "GET" && url.pathname === "/api/runtime") {
        if (!options.getRuntimeInfo) {
          return errorResponse(
            "not_found",
            "The API endpoint does not exist.",
            404,
          )
        }
        return sensitiveJson(options.getRuntimeInfo())
      }

      if (request.method === "GET" && url.pathname === "/api/ai/catalog") {
        if (!options.aiSettings) {
          return errorResponse(
            "not_found",
            "The API endpoint does not exist.",
            404,
          )
        }
        return json(options.aiSettings.getCatalog())
      }

      if (request.method === "GET" && url.pathname === "/api/ai/settings") {
        if (!options.aiSettings) {
          return errorResponse(
            "not_found",
            "The API endpoint does not exist.",
            404,
          )
        }
        return sensitiveJson({ settings: options.aiSettings.get() ?? null })
      }

      if (
        (request.method === "PUT" && url.pathname === "/api/ai/settings") ||
        (request.method === "POST" &&
          url.pathname === "/api/ai/settings/validate")
      ) {
        if (!options.aiSettings) {
          return errorResponse(
            "not_found",
            "The API endpoint does not exist.",
            404,
          )
        }

        let input: AiSettingsInput
        try {
          const body = await parseJsonBody(request)
          assertAiSettingsInput(body)
          input = body
        } catch (error) {
          const message =
            error instanceof SyntaxError
              ? "The request body is not valid JSON."
              : error instanceof Error
                ? error.message
                : "The request is invalid."
          return errorResponse("invalid_request", message, 400)
        }

        try {
          return sensitiveJson(
            request.method === "PUT"
              ? options.aiSettings.save(input)
              : await options.aiSettings.validate(input),
          )
        } catch (error) {
          if (error instanceof AiSettingsError) {
            return errorResponse(error.code, error.message, error.status)
          }
          options.onError?.(error)
          return errorResponse(
            "internal_error",
            request.method === "PUT"
              ? "Unable to save AI settings."
              : "Unable to validate AI settings.",
            500,
          )
        }
      }

      if (request.method === "GET" && url.pathname === "/api/sessions") {
        let params: ListSessionsParams

        try {
          params = parseSessionParams(url)
        } catch (error) {
          return errorResponse(
            "invalid_request",
            "The session query is invalid.",
            400,
          )
        }

        try {
          return json(await options.core.listSessions(params))
        } catch (error) {
          if (error instanceof InvalidSessionCursorError) {
            return errorResponse(
              "invalid_request",
              "The session cursor is invalid or does not match the current filters.",
              400,
            )
          }

          options.onError?.(error)
          return errorResponse(
            "internal_error",
            "The Server encountered an internal error.",
            500,
          )
        }
      }

      const titleSuggestionMatch = url.pathname.match(
        /^\/api\/sessions\/([^/]+)\/([^/]+)\/([^/]+)\/title-suggestion$/,
      )
      if (request.method === "POST" && titleSuggestionMatch) {
        if (!options.sessions || !options.aiSettings?.suggestSessionTitle) {
          return errorResponse(
            "not_found",
            "The API endpoint does not exist.",
            404,
          )
        }
        const sessions = options.sessions
        const aiSettings = options.aiSettings
        const suggestSessionTitle = aiSettings.suggestSessionTitle!

        let collectorId: string
        let detailRequest: GetSessionDetailRequest
        try {
          collectorId = decodeURIComponent(titleSuggestionMatch[1]!)
          const candidate = {
            agent: decodeURIComponent(titleSuggestionMatch[2]!),
            id: decodeURIComponent(titleSuggestionMatch[3]!),
            limit: 20 as const,
          }
          assertGetSessionDetailRequest(candidate)
          detailRequest = candidate
        } catch {
          return errorResponse(
            "invalid_request",
            "The session title suggestion request is invalid.",
            400,
          )
        }

        const suggest = async (
          onStatus?: (message: string) => void,
        ): Promise<SessionTitleSuggestion> => {
          onStatus?.("Reading the first 20 session messages.")
          const detail = await sessions.getDetail(
            collectorId,
            detailRequest,
          )
          return suggestSessionTitle.call(aiSettings, detail.items, onStatus)
        }
        const errorDetails = (error: unknown) => {
          if (
            error instanceof SessionManagementError ||
            error instanceof AiSettingsError
          ) {
            return {
              code: error.code,
              message: error.message,
              status: error.status,
            }
          }
          options.onError?.(error)
          return {
            code: "internal_error",
            message: "Unable to generate a session title.",
            status: 500,
          }
        }

        if (request.headers.get("accept")?.includes("application/x-ndjson")) {
          return jsonLineStream(async (send) => {
            try {
              const suggestion = await suggest((message) =>
                send({ type: "status", message }),
              )
              send({ type: "result", data: suggestion })
            } catch (error) {
              send({ type: "error", error: errorDetails(error) })
            }
          })
        }

        try {
          return sensitiveJson(await suggest())
        } catch (error) {
          const details = errorDetails(error)
          return errorResponse(details.code, details.message, details.status)
        }
      }

      const sessionMatch = url.pathname.match(
        /^\/api\/sessions\/([^/]+)\/([^/]+)\/([^/]+)$/,
      )
      if (request.method === "GET" && sessionMatch && options.sessions) {
        let collectorId: string
        let detailRequest: GetSessionDetailRequest
        try {
          collectorId = decodeURIComponent(sessionMatch[1]!)
          const candidate = {
            agent: decodeURIComponent(sessionMatch[2]!),
            id: decodeURIComponent(sessionMatch[3]!),
            limit: Number(
              url.searchParams.get("limit") ?? "20",
            ) as SessionDetailPageSize,
            cursor: url.searchParams.get("cursor") ?? undefined,
          }
          assertGetSessionDetailRequest(candidate)
          detailRequest = candidate
        } catch {
          return errorResponse(
            "invalid_request",
            "The session detail request is invalid.",
            400,
          )
        }

        try {
          return sensitiveJson(
            await options.sessions.getDetail(collectorId, detailRequest),
          )
        } catch (error) {
          if (error instanceof SessionManagementError) {
            return errorResponse(error.code, error.message, error.status)
          }
          options.onError?.(error)
          return errorResponse(
            "internal_error",
            "Unable to load the session detail.",
            500,
          )
        }
      }
      if (request.method === "PATCH" && sessionMatch && options.sessions) {
        let collectorId: string
        let update: UpdateSessionTitleRequest
        try {
          const body = await parseJsonBody(request)
          collectorId = decodeURIComponent(sessionMatch[1]!)
          const candidate = {
            agent: decodeURIComponent(sessionMatch[2]!),
            id: decodeURIComponent(sessionMatch[3]!),
            title: body.title,
            expectedTitle: body.expectedTitle,
            expectedUpdatedAt: body.expectedUpdatedAt,
          }
          assertUpdateSessionTitleRequest(candidate)
          update = candidate
        } catch {
          return errorResponse(
            "invalid_request",
            "The session title update is invalid.",
            400,
          )
        }

        try {
          return json(await options.sessions.updateTitle(collectorId, update))
        } catch (error) {
          if (error instanceof SessionManagementError) {
            return errorResponse(error.code, error.message, error.status)
          }
          options.onError?.(error)
          return errorResponse(
            "internal_error",
            "Unable to update the session title.",
            500,
          )
        }
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/session-directories"
      ) {
        if (!options.projects) {
          return errorResponse(
            "not_found",
            "The API endpoint does not exist.",
            404,
          )
        }
        return json({ items: options.projects.listDirectories() })
      }

      if (url.pathname === "/api/projects") {
        if (!options.projects) {
          return errorResponse(
            "not_found",
            "The API endpoint does not exist.",
            404,
          )
        }
        if (request.method === "GET") {
          return json({ items: options.projects.list() })
        }
        if (request.method === "POST") {
          try {
            const body = await parseJsonBody(request)
            assertProjectInput(body)
            return json(options.projects.create(body), 201)
          } catch (error) {
            if (error instanceof ProjectManagementError) {
              return errorResponse(error.code, error.message, error.status)
            }
            return errorResponse(
              "invalid_request",
              "The project data is invalid.",
              400,
            )
          }
        }
      }

      const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/)
      if (projectMatch && options.projects) {
        const id = projectMatch[1]!
        try {
          if (request.method === "PATCH") {
            const body = await parseJsonBody(request)
            assertProjectInput(body)
            return json(options.projects.update(id, body))
          }
          if (request.method === "DELETE") {
            options.projects.delete(id)
            return new Response(null, { status: 204 })
          }
        } catch (error) {
          if (error instanceof ProjectManagementError) {
            return errorResponse(error.code, error.message, error.status)
          }
          return errorResponse(
            "invalid_request",
            "The project update is invalid.",
            400,
          )
        }
      }

      if (url.pathname === "/api/collectors") {
        if (!options.collectors) {
          return errorResponse(
            "not_found",
            "The API endpoint does not exist.",
            404,
          )
        }

        if (request.method === "GET") {
          return json({ items: options.collectors.list() })
        }

        if (request.method === "POST") {
          try {
            const body = await parseJsonBody(request)
            assertCreateCollectorInput(body)
            return sensitiveJson(options.collectors.create(body), 201)
          } catch (error) {
            if (error instanceof CollectorManagementError) {
              return errorResponse(error.code, error.message, error.status)
            }
            return errorResponse(
              "invalid_request",
              "The collector data is invalid.",
              400,
            )
          }
        }
      }

      const tokenMatch = url.pathname.match(
        /^\/api\/collectors\/([^/]+)\/token$/,
      )
      if (request.method === "GET" && tokenMatch && options.collectors) {
        try {
          return sensitiveJson({
            token: options.collectors.revealToken(tokenMatch[1]!),
          })
        } catch (error) {
          if (error instanceof CollectorManagementError) {
            return errorResponse(error.code, error.message, error.status)
          }
          options.onError?.(error)
          return errorResponse(
            "internal_error",
            "Unable to load the collector token.",
            500,
          )
        }
      }

      const syncMatch = url.pathname.match(/^\/api\/collectors\/([^/]+)\/sync$/)
      if (request.method === "POST" && syncMatch && options.collectors) {
        try {
          options.collectors.sync(syncMatch[1]!)
          return json({ accepted: true }, 202)
        } catch (error) {
          if (error instanceof CollectorManagementError) {
            return errorResponse(error.code, error.message, error.status)
          }
          options.onError?.(error)
          return errorResponse(
            "internal_error",
            "Unable to start collector sync.",
            500,
          )
        }
      }

      const collectorMatch = url.pathname.match(/^\/api\/collectors\/([^/]+)$/)
      if (collectorMatch && options.collectors) {
        const id = collectorMatch[1]!
        try {
          if (request.method === "PATCH") {
            const body = await parseJsonBody(request)
            assertCollectorName(body.name)
            return json(options.collectors.rename(id, body.name))
          }
          if (request.method === "DELETE") {
            options.collectors.delete(id)
            return new Response(null, { status: 204 })
          }
        } catch (error) {
          if (error instanceof CollectorManagementError) {
            return errorResponse(error.code, error.message, error.status)
          }
          return errorResponse(
            "invalid_request",
            "The collector update is invalid.",
            400,
          )
        }
      }

      return errorResponse("not_found", "The API endpoint does not exist.", 404)
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 })
    }

    if (!options.webRoot) {
      return new Response("Not Found", { status: 404 })
    }

    const response = await serveWebFile(options.webRoot, url)
    return request.method === "HEAD"
      ? new Response(null, {
          headers: response.headers,
          status: response.status,
        })
      : response
  }
}
