import { afterEach, describe, expect, it, vi } from "vitest"

const xrpcMock = vi.hoisted(() => vi.fn())

vi.mock("./session.js", () => ({
  xrpc: xrpcMock,
}))

import { getPostRef, parsePostUrl, resolveHandle } from "./resolve.js"

afterEach(() => {
  xrpcMock.mockReset()
})

describe("resolveHandle", () => {
  it("returns a did as-is without calling the network", async () => {
    const did = await resolveHandle("did:plc:abc123")
    expect(did).toBe("did:plc:abc123")
    expect(xrpcMock).not.toHaveBeenCalled()
  })

  it("resolves a handle via the identity endpoint, stripping a leading @", async () => {
    xrpcMock.mockResolvedValueOnce({ did: "did:plc:resolved" })
    const did = await resolveHandle("@kud.io")
    expect(did).toBe("did:plc:resolved")
    expect(xrpcMock).toHaveBeenCalledWith(
      "com.atproto.identity.resolveHandle",
      { params: { handle: "kud.io" }, auth: false },
    )
  })

  it("propagates an error when the handle cannot be resolved", async () => {
    xrpcMock.mockRejectedValueOnce(new Error("resolveHandle failed (400)"))
    await expect(resolveHandle("nonexistent.example")).rejects.toThrow(
      "resolveHandle failed (400)",
    )
  })
})

describe("parsePostUrl", () => {
  it("parses an at:// URI", async () => {
    const { did, rkey } = await parsePostUrl(
      "at://did:plc:abc123/app.bsky.feed.post/xyz789",
    )
    expect(did).toBe("did:plc:abc123")
    expect(rkey).toBe("xyz789")
    expect(xrpcMock).not.toHaveBeenCalled()
  })

  it("throws on a malformed at:// URI missing an rkey", async () => {
    await expect(parsePostUrl("at://did:plc:abc123")).rejects.toThrow(
      "Unrecognised at:// URI",
    )
  })

  it("parses a bsky.app profile/post URL, resolving the handle to a did", async () => {
    xrpcMock.mockResolvedValueOnce({ did: "did:plc:resolved" })
    const { did, rkey } = await parsePostUrl(
      "https://bsky.app/profile/kud.io/post/xyz789",
    )
    expect(did).toBe("did:plc:resolved")
    expect(rkey).toBe("xyz789")
  })

  it("throws on a URL that isn't a recognised post URL", async () => {
    await expect(parsePostUrl("https://example.com/nope")).rejects.toThrow(
      "Unrecognised post URL",
    )
  })
})

describe("getPostRef", () => {
  it("returns the post ref and falls back to itself as root when not a reply", async () => {
    xrpcMock
      .mockResolvedValueOnce({ did: "did:plc:resolved" }) // resolveHandle
      .mockResolvedValueOnce({
        uri: "at://did:plc:resolved/app.bsky.feed.post/xyz789",
        cid: "bafycid",
        value: {},
      }) // getRecord

    const { ref, root } = await getPostRef(
      "https://bsky.app/profile/kud.io/post/xyz789",
    )
    expect(ref).toEqual({
      uri: "at://did:plc:resolved/app.bsky.feed.post/xyz789",
      cid: "bafycid",
    })
    expect(root).toEqual(ref)
  })

  it("returns the thread root when the post is a reply", async () => {
    const rootRef = {
      uri: "at://did:plc:root/app.bsky.feed.post/root1",
      cid: "cidroot",
    }
    xrpcMock
      .mockResolvedValueOnce({ did: "did:plc:resolved" }) // resolveHandle
      .mockResolvedValueOnce({
        uri: "at://did:plc:resolved/app.bsky.feed.post/xyz789",
        cid: "bafycid",
        value: { reply: { root: rootRef } },
      }) // getRecord

    const { ref, root } = await getPostRef(
      "https://bsky.app/profile/kud.io/post/xyz789",
    )
    expect(ref).toEqual({
      uri: "at://did:plc:resolved/app.bsky.feed.post/xyz789",
      cid: "bafycid",
    })
    expect(root).toEqual(rootRef)
  })
})
