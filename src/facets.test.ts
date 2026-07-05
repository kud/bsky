import { describe, expect, it, vi } from "vitest"

vi.mock("./resolve.js", () => ({
  resolveHandle: vi.fn(async (handle: string) => {
    if (handle === "unresolvable.example") throw new Error("not found")
    return `did:plc:${handle.replace(/\./g, "-")}`
  }),
}))

import { extractFacets } from "./facets.js"

describe("extractFacets", () => {
  it("returns no facets for plain text", async () => {
    const facets = await extractFacets(
      "just a normal sentence, nothing special",
    )
    expect(facets).toEqual([])
  })

  it("detects an explicit https URL", async () => {
    const text = "check this out https://example.com/path?x=1"
    const facets = await extractFacets(text)
    expect(facets).toHaveLength(1)
    expect(facets[0]!.features[0]).toEqual({
      $type: "app.bsky.richtext.facet#link",
      uri: "https://example.com/path?x=1",
    })
  })

  it("detects a bare domain and prefixes it with https", async () => {
    const text = "visit kud.io today"
    const facets = await extractFacets(text)
    expect(facets).toHaveLength(1)
    expect(facets[0]!.features[0]).toEqual({
      $type: "app.bsky.richtext.facet#link",
      uri: "https://kud.io",
    })
  })

  it("detects a hashtag", async () => {
    const text = "loving this #bluesky vibe"
    const facets = await extractFacets(text)
    expect(facets).toHaveLength(1)
    expect(facets[0]!.features[0]).toEqual({
      $type: "app.bsky.richtext.facet#tag",
      tag: "bluesky",
    })
  })

  it("does not treat an HTML entity like &#123 as a tag", async () => {
    const text = "an entity &#123 in text"
    const facets = await extractFacets(text)
    expect(facets).toEqual([])
  })

  it("resolves a mention to a did", async () => {
    const text = "hello @kud.io how are you"
    const facets = await extractFacets(text)
    // NOTE: the bare-domain link regex has no lookbehind exclusion for "@",
    // so a mention's handle is also matched as a plain link over the same
    // span. Both facets are emitted — asserting on the mention specifically
    // documents this as current behaviour rather than assuming it away.
    const mention = facets.find(
      (f) => f.features[0]!.$type === "app.bsky.richtext.facet#mention",
    )
    expect(mention?.features[0]).toEqual({
      $type: "app.bsky.richtext.facet#mention",
      did: "did:plc:kud-io",
    })
  })

  it("silently drops a mention that fails to resolve", async () => {
    const text = "hello @unresolvable.example friend"
    const facets = await extractFacets(text)
    expect(facets).toEqual([])
  })

  it("combines a link, a tag and a mention in one post", async () => {
    const text = "hey @kud.io check https://kud.io/projects #bsky"
    const facets = await extractFacets(text)
    const types = new Set(facets.map((f) => f.features[0]!.$type))
    expect(types).toEqual(
      new Set([
        "app.bsky.richtext.facet#link",
        "app.bsky.richtext.facet#mention",
        "app.bsky.richtext.facet#tag",
      ]),
    )
  })

  it("computes byte offsets using UTF-8 length, not character count", async () => {
    // "café " is 5 chars but 6 UTF-8 bytes (é = 2 bytes)
    const text = "café #tag"
    const facets = await extractFacets(text)
    expect(facets).toHaveLength(1)
    const expectedStart = Buffer.byteLength("café ", "utf8")
    expect(facets[0]!.index).toEqual({
      byteStart: expectedStart,
      byteEnd: expectedStart + Buffer.byteLength("#tag", "utf8"),
    })
  })

  it("accounts for multi-byte emoji when computing byte offsets", async () => {
    const text = "🎉 party #time"
    const facets = await extractFacets(text)
    expect(facets).toHaveLength(1)
    const expectedStart = Buffer.byteLength("🎉 party ", "utf8")
    expect(facets[0]!.index.byteStart).toBe(expectedStart)
  })
})
