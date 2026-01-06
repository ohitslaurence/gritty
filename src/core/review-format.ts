import type { PRReview } from "../services/ai/service"

/**
 * Format severity with emoji for display.
 */
export const formatSeverity = (severity: string): string => {
  switch (severity) {
    case "critical":
      return "🚨 CRITICAL"
    case "suggestion":
      return "💡 Suggestion"
    case "nitpick":
      return "📝 Nitpick"
    case "praise":
      return "✨ Praise"
    default:
      return severity
  }
}

/**
 * Format verdict with emoji for display.
 */
export const formatVerdict = (verdict: string): string => {
  switch (verdict) {
    case "approve":
      return "✅ APPROVE"
    case "request_changes":
      return "🔴 REQUEST CHANGES"
    case "comment":
      return "💬 COMMENT"
    default:
      return verdict
  }
}

/**
 * Format a PR review for terminal display.
 */
export const formatReview = (review: PRReview, prNumber: number): string => {
  const separator = "─".repeat(60)
  const lines = [
    "",
    separator,
    `PR #${prNumber} Review`,
    separator,
    "",
    `Verdict: ${formatVerdict(review.verdict)}`,
    "",
    review.summary,
    "",
  ]

  if (review.comments.length > 0) {
    lines.push(separator)
    lines.push("Comments:")
    lines.push("")

    for (const comment of review.comments) {
      const location = comment.line ? `:${comment.line}` : ""
      lines.push(`${formatSeverity(comment.severity)}`)
      lines.push(`  ${comment.file}${location}`)
      lines.push(`  ${comment.comment}`)
      lines.push("")
    }
  }

  lines.push(separator)
  return lines.join("\n")
}
