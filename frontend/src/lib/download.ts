const FALLBACK_ERROR = "Could not create download."
const REVOKE_DELAY_MS = 1000

export async function download(path: string, fallbackName: string) {
  const response = await fetch(path)
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: unknown }
    throw new Error(
      typeof body?.detail === "string" && body.detail ? body.detail : FALLBACK_ERROR,
    )
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = response.headers.get("Content-Disposition")?.match(/filename="?([^";]+)"?/)?.[1] ?? fallbackName
  anchor.style.display = "none"
  document.body.appendChild(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    // Revoking immediately can abort the download in Firefox and Safari.
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
  }
}
