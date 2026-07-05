import { describe, expect, it, vi } from "vitest"

vi.mock("./session.js", () => ({
  getSession: vi.fn(),
  xrpc: vi.fn(),
  PDS: "https://bsky.social",
}))
vi.mock("./facets.js", () => ({ extractFacets: vi.fn(async () => []) }))
vi.mock("./resolve.js", () => ({
  getPostRef: vi.fn(),
  parsePostUrl: vi.fn(),
}))

import { checkLength, postWebUrl } from "./posts.js"

describe("checkLength", () => {
  it("does not throw for text under the limit", () => {
    expect(() => checkLength("hello world")).not.toThrow()
  })

  it("does not throw for text at exactly the limit", () => {
    expect(() => checkLength("a".repeat(300))).not.toThrow()
  })

  it("throws for text over the limit", () => {
    expect(() => checkLength("a".repeat(301))).toThrow(
      "Post is 301 chars — Bluesky limit is 300.",
    )
  })

  it("counts unicode code points, not UTF-16 code units", () => {
    // each of these emoji is 2 UTF-16 code units but 1 code point
    const text = "🎉".repeat(300)
    expect(() => checkLength(text)).not.toThrow()
    expect(() => checkLength("🎉".repeat(301))).toThrow(
      "Post is 301 chars — Bluesky limit is 300.",
    )
  })
})

describe("postWebUrl", () => {
  it("builds a bsky.app profile/post URL from a handle and rkey", () => {
    expect(postWebUrl("kud.io", "abc123")).toBe(
      "https://bsky.app/profile/kud.io/post/abc123",
    )
  })
})
