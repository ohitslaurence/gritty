/**
 * Default prompt template for commit message generation.
 *
 * This prompt is used when no custom prompt is configured.
 * Users can override it by creating ~/.gritty/prompts/commit.md
 */
export const DEFAULT_COMMIT_PROMPT = `You are an expert developer writing a git commit message. Analyze the following diff and generate a clear, concise commit message.

<diff>
{{diff}}
</diff>

{{#if recent_commits}}
<recent_commits>
{{recent_commits}}
</recent_commits>
{{/if}}

{{#if style}}
<style>
{{style}}
</style>
{{/if}}

{{#if context}}
<context>
{{context}}
</context>
{{/if}}

Generate a commit message that:
1. Follows the detected style/format (or Conventional Commits if unclear)
2. Has a clear, imperative subject line (max 72 chars)
3. Includes a body if the change is complex (wrapped at 72 chars)
4. Notes any breaking changes with "BREAKING CHANGE:" prefix

Output ONLY the commit message, no explanation or markdown formatting.`

/**
 * Get the style description for the prompt.
 */
export const getStyleDescription = (
  style: { _tag: "Conventional"; scopes: readonly string[] } | { _tag: "Gitmoji" } | { _tag: "Freeform" }
): string => {
  switch (style._tag) {
    case "Conventional":
      return `Use Conventional Commits format: type(scope): description
Common types: feat, fix, docs, style, refactor, test, chore
Available scopes from repo: ${style.scopes.join(", ") || "none detected"}`
    case "Gitmoji":
      return "Use gitmoji format with an appropriate emoji at the start (e.g., ✨ for new feature, 🐛 for bug fix)"
    case "Freeform":
      return "Use a clear, professional commit message format with an imperative subject line"
  }
}
