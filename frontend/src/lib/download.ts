export async function download(path: string, fallbackName: string) {
  const response = await fetch(path)
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: string }
    throw new Error(body.detail ?? "Could not create download.")
  }
  const blob = await response.blob()
  const anchor = document.createElement("a")
  anchor.href = URL.createObjectURL(blob)
  anchor.download = response.headers.get("Content-Disposition")?.match(/filename="?([^";]+)"?/)?.[1] ?? fallbackName
  anchor.click()
  URL.revokeObjectURL(anchor.href)
}
