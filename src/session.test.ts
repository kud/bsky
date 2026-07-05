import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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
