export const INPUT_PLACEHOLDER = "{{input}}"
export const MAX_PROMPT_CONTENT_LENGTH = 20_000
export const MAX_SYSTEM_PROMPT_LENGTH = 20_000

const PLACEHOLDER_PATTERN = /{{[^{}]*}}/g

export function validatePromptContent(content: string): string | null {
  if (!content.trim()) return "Prompt content is required."
  if (content.length > MAX_PROMPT_CONTENT_LENGTH) {
    return `Prompt content must contain at most ${MAX_PROMPT_CONTENT_LENGTH.toLocaleString()} characters.`
  }

  const placeholders = content.match(PLACEHOLDER_PATTERN) ?? []
  if (placeholders.length !== 1 || placeholders[0] !== INPUT_PLACEHOLDER) {
    return "Include {{input}} exactly once and do not use other placeholders."
  }
  return null
}

export function validateSystemPrompt(systemPrompt: string): string | null {
  if (systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH) {
    return `System prompt must contain at most ${MAX_SYSTEM_PROMPT_LENGTH.toLocaleString()} characters.`
  }
  if (/{{[^{}]*}}/.test(systemPrompt)) {
    return "System prompt must not contain placeholders."
  }
  return null
}
