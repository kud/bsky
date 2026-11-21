import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./session.js", () => ({ xrpc: vi.fn() }))
vi.mock("./resolve.js", () => ({
  parsePostUrl: vi.fn(async () => ({
    did: "did:plc:alice",
    rkey: "3kexample",
  })),
  resolveHandle: vi.fn(),
}))

import { xrpc } from "./session.js"
import { getThread } from "./read.js"

const URL = "https://bsky.app/profile/alice.example.com/post/3kexample"
const ROOT_URI = "at://did:plc:alice/app.bsky.feed.post/3kexample"

const raw = (n: number) => ({
  uri: `at://did:plc:alice/app.bsky.feed.post/${n}`,
  author: { handle: "alice.example.com" },
  record: { text: `post ${n}`, createdAt: "2026-01-01T00:00:00Z" },
})
const viewPost = (n: number) => ({
  $type: "app.bsky.feed.defs#threadViewPost",
  post: raw(n),
})
const notFound = (uri: string) => ({
  $type: "app.bsky.feed.defs#notFoundPost",
  uri,
  notFound: true,
})
const blocked = (uri: string) => ({
  $type: "app.bsky.feed.defs#blockedPost",
  uri,
  blocked: true,
  author: { did: "did:plc:bob" },
})

const respond = (thread: unknown) =>
  vi.mocked(xrpc).mockResolvedValueOnce({ thread })

beforeEach(() => vi.mocked(xrpc).mockReset())

describe("getThread", () => {
  it("returns the post followed by its direct replies", async () => {
    respond({ ...viewPost(1), replies: [viewPost(2), viewPost(3)] })
    const posts = await getThread(URL)
    expect(posts.map((p) => p.text)).toEqual(["post 1", "post 2", "post 3"])
  })

  it("skips replies that are not found or blocked", async () => {
    respond({
      ...viewPost(1),
      replies: [
        notFound("at://x/app.bsky.feed.post/gone"),
        viewPost(2),
        blocked("at://x/app.bsky.feed.post/hidden"),
        viewPost(3),
      ],
    })
    const posts = await getThread(URL)
    expect(posts.map((p) => p.text)).toEqual(["post 1", "post 2", "post 3"])
  })

  it("applies the limit to the available replies only", async () => {
    respond({
      ...viewPost(1),
      replies: [notFound("at://x/gone"), viewPost(2), viewPost(3)],
    })
    const posts = await getThread(URL, 1)
    expect(posts.map((p) => p.text)).toEqual(["post 1", "post 2"])
  })

  it("throws a clear error when the root post was not found", async () => {
    respond(notFound(ROOT_URI))
    await expect(getThread(URL)).rejects.toThrow(
      `Post ${ROOT_URI} was not found.`,
    )
  })

  it("throws a clear error when the root post is blocked", async () => {
    respond(blocked(ROOT_URI))
    await expect(getThread(URL)).rejects.toThrow(`Post ${ROOT_URI} is blocked.`)
  })
})
