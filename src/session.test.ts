import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest"
import type { Session } from "./index.js"

const originalHandle = process.env.BLUESKY_HANDLE
const originalPassword = process.env.BLUESKY_APP_PASSWORD

const jsonResponse = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
})

beforeEach(() => {
  vi.resetModules()
  delete process.env.BLUESKY_HANDLE
  delete process.env.BLUESKY_APP_PASSWORD
  vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (originalHandle === undefined) delete process.env.BLUESKY_HANDLE
  else process.env.BLUESKY_HANDLE = originalHandle
  if (originalPassword === undefined) delete process.env.BLUESKY_APP_PASSWORD
  else process.env.BLUESKY_APP_PASSWORD = originalPassword
})

describe("getSession", () => {
  it("throws a descriptive error when credentials are missing", async () => {
    const { getSession } = await import("./session.js")
    await expect(getSession()).rejects.toThrow(/Missing credentials/)
  })

  it("throws when the auth request fails", async () => {
    process.env.BLUESKY_HANDLE = "kud.io"
    process.env.BLUESKY_APP_PASSWORD = "app-password"
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "bad creds" }, false, 401)),
    )
    const { getSession } = await import("./session.js")
    await expect(getSession()).rejects.toThrow(/Auth failed \(401\)/)
  })

  it("caches the session after a successful login", async () => {
    process.env.BLUESKY_HANDLE = "kud.io"
    process.env.BLUESKY_APP_PASSWORD = "app-password"
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        accessJwt: "jwt",
        did: "did:plc:abc",
        handle: "kud.io",
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const { getSession } = await import("./session.js")
    const first = await getSession()
    const second = await getSession()
    expect(first).toEqual(second)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("public session", () => {
  it("does not expose the refresh token in the Session type", () => {
    expectTypeOf<Session>().toEqualTypeOf<{
      accessJwt: string
      did: string
      handle: string
    }>()
    expectTypeOf<Session>().not.toHaveProperty("refreshJwt")
  })

  it("strips the refresh token from what getSession returns", async () => {
    process.env.BLUESKY_HANDLE = "kud.io"
    process.env.BLUESKY_APP_PASSWORD = "app-password"
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          accessJwt: "jwt",
          refreshJwt: "refresh",
          did: "did:plc:abc",
          handle: "kud.io",
        }),
      ),
    )
    const { getSession } = await import("./index.js")
    expect(await getSession()).toEqual({
      accessJwt: "jwt",
      did: "did:plc:abc",
      handle: "kud.io",
    })
  })
})

describe("environment access", () => {
  it("reads no environment variable at import, only on the first getSession call", async () => {
    vi.stubEnv("BLUESKY_HANDLE", "kud.io")
    vi.stubEnv("BLUESKY_APP_PASSWORD", "app-password")
    const reads: string[] = []
    const env = process.env
    vi.stubGlobal(
      "process",
      new Proxy(process, {
        get: (target, prop, receiver) =>
          prop === "env"
            ? new Proxy(env, {
                get: (e, key) => {
                  if (typeof key === "string") reads.push(key)
                  return Reflect.get(e, key)
                },
              })
            : Reflect.get(target, prop, receiver),
      }),
    )
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ accessJwt: "jwt", did: "did:plc:abc", handle: "kud.io" }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const { getSession } = await import("./index.js")
    expect(reads).toEqual([])

    await getSession()
    expect(reads).toEqual(
      expect.arrayContaining(["BLUESKY_HANDLE", "BLUESKY_APP_PASSWORD"]),
    )
    const [, init] = fetchMock.mock.calls[0]!
    expect(JSON.parse(init?.body as string)).toEqual({
      identifier: "kud.io",
      password: "app-password",
    })
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
})

describe("xrpc", () => {
  it("builds a query string from params, skipping undefined values", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }))
    vi.stubGlobal("fetch", fetchMock)
    const { xrpc } = await import("./session.js")

    await xrpc("com.atproto.identity.resolveHandle", {
      params: { handle: "kud.io", limit: undefined },
      auth: false,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=kud.io",
      expect.objectContaining({ method: "GET" }),
    )
  })

  it("skips the Authorization header when auth is false", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ ok: true }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const { xrpc } = await import("./session.js")

    await xrpc("com.atproto.identity.resolveHandle", {
      params: { handle: "kud.io" },
      auth: false,
    })

    const [, init] = fetchMock.mock.calls[0]!
    expect(init?.headers).not.toHaveProperty("Authorization")
  })

  it("maps a non-ok response to a descriptive error", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ message: "nope" }, false, 500),
    )
    vi.stubGlobal("fetch", fetchMock)
    const { xrpc } = await import("./session.js")

    await expect(
      xrpc("app.bsky.feed.getTimeline", { auth: false }),
    ).rejects.toThrow(/app\.bsky\.feed\.getTimeline failed \(500\)/)
  })
})

describe("session refresh", () => {
  const response = (body: unknown, status = 200) => {
    const res = {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
      clone: () => res,
    }
    return res
  }
  const expired = () =>
    response({ error: "ExpiredToken", message: "Token has expired" }, 400)
  const session = (n: number) => ({
    accessJwt: `access-${n}`,
    refreshJwt: `refresh-${n}`,
    did: "did:plc:alice",
    handle: "alice.example.com",
  })
  const bearer = (init?: RequestInit) =>
    (init?.headers as Record<string, string> | undefined)?.Authorization

  beforeEach(() => {
    process.env.BLUESKY_HANDLE = "alice.example.com"
    process.env.BLUESKY_APP_PASSWORD = "app-password"
  })

  it("refreshes an expired access token and retries the call once", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("createSession")) return response(session(1))
      if (url.endsWith("refreshSession")) {
        expect(bearer(init)).toBe("Bearer refresh-1")
        return response(session(2))
      }
      return bearer(init) === "Bearer access-2"
        ? response({ feed: [] })
        : expired()
    })
    vi.stubGlobal("fetch", fetchMock)
    const { xrpc, getSession } = await import("./session.js")

    await expect(xrpc("app.bsky.feed.getTimeline")).resolves.toEqual({
      feed: [],
    })
    expect((await getSession()).accessJwt).toBe("access-2")
    const urls = fetchMock.mock.calls.map(([url]) => url.split("/").pop())
    expect(urls).toEqual([
      "com.atproto.server.createSession",
      "app.bsky.feed.getTimeline",
      "com.atproto.server.refreshSession",
      "app.bsky.feed.getTimeline",
    ])
  })

  it("logs in again when the refresh is rejected", async () => {
    let logins = 0
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("createSession")) return response(session(++logins * 10))
      if (url.endsWith("refreshSession"))
        return response({ error: "ExpiredToken" }, 400)
      return bearer(init) === "Bearer access-20"
        ? response({ ok: true })
        : expired()
    })
    vi.stubGlobal("fetch", fetchMock)
    const { xrpc } = await import("./session.js")

    await expect(xrpc("app.bsky.actor.getProfile")).resolves.toEqual({
      ok: true,
    })
    expect(logins).toBe(2)
  })

  it("retries only once and then surfaces the error", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("createSession")) return response(session(1))
      if (url.endsWith("refreshSession")) return response(session(2))
      return expired()
    })
    vi.stubGlobal("fetch", fetchMock)
    const { xrpc } = await import("./session.js")

    await expect(xrpc("app.bsky.feed.getTimeline")).rejects.toThrow(
      /getTimeline failed \(400\)/,
    )
    const calls = fetchMock.mock.calls.filter(([url]) =>
      url.endsWith("getTimeline"),
    )
    expect(calls).toHaveLength(2)
  })

  it("does not refresh on unrelated errors", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("createSession")) return response(session(1))
      return response({ error: "InvalidRequest" }, 400)
    })
    vi.stubGlobal("fetch", fetchMock)
    const { xrpc } = await import("./session.js")

    await expect(xrpc("app.bsky.feed.getTimeline")).rejects.toThrow(
      /failed \(400\)/,
    )
    expect(
      fetchMock.mock.calls.some(([url]) => url.endsWith("refreshSession")),
    ).toBe(false)
  })
})
