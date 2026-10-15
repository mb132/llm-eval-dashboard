import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { download } from "@/lib/download"

describe("download", () => {
  const fetchMock = vi.fn<typeof fetch>()
  const createObjectURL = vi.fn(() => "blob:test-url")
  const revokeObjectURL = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
    vi.stubGlobal("fetch", fetchMock)
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("clicks an attached anchor and revokes the object URL only after a delay", async () => {
    fetchMock.mockResolvedValue(
      new Response("a,b", { headers: { "Content-Disposition": 'attachment; filename="cases.csv"' } }),
    )
    let attachedDuringClick = false
    let downloadName = ""
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      attachedDuringClick = document.body.contains(this)
      downloadName = this.download
    })

    await download("/api/export", "fallback.csv")

    expect(attachedDuringClick).toBe(true)
    expect(downloadName).toBe("cases.csv")
    expect(document.querySelector("a[download]")).toBeNull()
    expect(revokeObjectURL).not.toHaveBeenCalled()

    await vi.runAllTimersAsync()
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:test-url")
  })

  it("rejects with the server detail on failure", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: "Dataset not found." }), { status: 404 }),
    )
    await expect(download("/api/export", "x.json")).rejects.toThrow("Dataset not found.")
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it("falls back to a generic message when detail is not a string", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: [{ msg: "bad format", loc: ["query", "format"] }] }), {
        status: 422,
      }),
    )
    await expect(download("/api/export", "x.json")).rejects.toThrow(
      "Could not create download.",
    )
  })
})
