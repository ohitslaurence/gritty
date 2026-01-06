import { describe, expect, it } from "bun:test"
import {
  aggregateChunkReviews,
  isStateStale,
  getIncompleteChunks,
  getCompletedChunks,
  createInitialState,
} from "./chunked-review"
import type { ChunkReviewResult, ReviewState, ChunkState, FileGroup } from "../types/review-state"
import type { ReviewComment } from "../services/ai/service"

// Test fixtures
const createComment = (overrides: Partial<ReviewComment> = {}): ReviewComment => ({
  file: "src/index.ts",
  severity: "suggestion",
  comment: "Consider using a more descriptive name",
  ...overrides,
})

const createChunkResult = (overrides: Partial<ChunkReviewResult> = {}): ChunkReviewResult => ({
  groupId: "chunk-1",
  summary: "This chunk looks good overall.",
  verdict: "approve",
  comments: [],
  ...overrides,
})

const createFileGroup = (overrides: Partial<FileGroup> = {}): FileGroup => ({
  id: "group-1",
  name: "Core files",
  reasoning: "Related core functionality",
  files: ["src/index.ts"],
  ...overrides,
})

const createChunkState = (overrides: Partial<ChunkState> = {}): ChunkState => ({
  group: createFileGroup(),
  status: "pending",
  ...overrides,
})

const createReviewState = (overrides: Partial<ReviewState> = {}): ReviewState => ({
  version: 1,
  prNumber: 123,
  owner: "owner",
  repo: "repo",
  headSha: "abc123",
  files: [],
  chunks: [],
  startedAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  ...overrides,
})

describe("chunked-review", () => {
  describe("aggregateChunkReviews", () => {
    describe("verdict aggregation", () => {
      it("returns approve when all chunks approve", () => {
        const chunks = [
          createChunkResult({ verdict: "approve" }),
          createChunkResult({ verdict: "approve" }),
        ]
        const result = aggregateChunkReviews(chunks)
        expect(result.verdict).toBe("approve")
      })

      it("returns request_changes when any chunk requests changes", () => {
        const chunks = [
          createChunkResult({ verdict: "approve" }),
          createChunkResult({ verdict: "request_changes" }),
          createChunkResult({ verdict: "comment" }),
        ]
        const result = aggregateChunkReviews(chunks)
        expect(result.verdict).toBe("request_changes")
      })

      it("returns comment when no request_changes but has comments", () => {
        const chunks = [
          createChunkResult({ verdict: "approve" }),
          createChunkResult({ verdict: "comment" }),
        ]
        const result = aggregateChunkReviews(chunks)
        expect(result.verdict).toBe("comment")
      })

      it("returns approve for empty chunks", () => {
        const result = aggregateChunkReviews([])
        expect(result.verdict).toBe("approve")
      })
    })

    describe("comment aggregation", () => {
      it("collects comments from all chunks", () => {
        const chunks = [
          createChunkResult({
            comments: [
              createComment({ file: "a.ts", comment: "Comment on file A" }),
            ],
          }),
          createChunkResult({
            comments: [
              createComment({ file: "b.ts", comment: "Comment on file B" }),
            ],
          }),
        ]
        const result = aggregateChunkReviews(chunks)
        expect(result.comments).toHaveLength(2)
      })

      it("deduplicates comments on same file and line with similar keywords", () => {
        const chunks = [
          createChunkResult({
            comments: [
              createComment({
                file: "src/index.ts",
                line: 10,
                comment: "Consider using a more descriptive variable name here",
              }),
            ],
          }),
          createChunkResult({
            comments: [
              createComment({
                file: "src/index.ts",
                line: 10,
                comment: "Use a more descriptive variable name for clarity",
              }),
            ],
          }),
        ]
        const result = aggregateChunkReviews(chunks)
        // Should deduplicate since same file/line and similar keywords
        expect(result.comments).toHaveLength(1)
      })

      it("keeps comments on different files", () => {
        const chunks = [
          createChunkResult({
            comments: [
              createComment({ file: "a.ts", line: 10, comment: "Same exact comment" }),
            ],
          }),
          createChunkResult({
            comments: [
              createComment({ file: "b.ts", line: 10, comment: "Same exact comment" }),
            ],
          }),
        ]
        const result = aggregateChunkReviews(chunks)
        expect(result.comments).toHaveLength(2)
      })

      it("keeps comments on different lines of same file", () => {
        const chunks = [
          createChunkResult({
            comments: [
              createComment({ file: "a.ts", line: 10, comment: "Same exact comment" }),
            ],
          }),
          createChunkResult({
            comments: [
              createComment({ file: "a.ts", line: 20, comment: "Same exact comment" }),
            ],
          }),
        ]
        const result = aggregateChunkReviews(chunks)
        expect(result.comments).toHaveLength(2)
      })
    })

    describe("summary synthesis", () => {
      it("joins summaries for 1-2 chunks", () => {
        const chunks = [
          createChunkResult({ summary: "First part looks good." }),
          createChunkResult({ summary: "Second part is fine." }),
        ]
        const result = aggregateChunkReviews(chunks)
        expect(result.summary).toBe("First part looks good. Second part is fine.")
      })

      it("cleans 'This chunk' prefix from summaries", () => {
        const chunks = [
          createChunkResult({ summary: "This chunk introduces new auth logic." }),
        ]
        const result = aggregateChunkReviews(chunks)
        expect(result.summary).toBe("introduces new auth logic.")
      })

      it("creates section headers for 3+ chunks", () => {
        const chunks = [
          createChunkResult({ summary: "Auth changes look good." }),
          createChunkResult({ summary: "API updates are solid." }),
          createChunkResult({ summary: "Tests are comprehensive." }),
        ]
        const result = aggregateChunkReviews(chunks)
        expect(result.summary).toContain("**Approved**")
        expect(result.summary).toContain("Reviewed 3 sections")
        expect(result.summary).toContain("**Section 1**")
        expect(result.summary).toContain("**Section 2**")
        expect(result.summary).toContain("**Section 3**")
      })

      it("shows correct verdict text in summary header", () => {
        const chunks = [
          createChunkResult({ verdict: "request_changes", summary: "Needs work." }),
          createChunkResult({ verdict: "approve", summary: "Good." }),
          createChunkResult({ verdict: "approve", summary: "Fine." }),
        ]
        const result = aggregateChunkReviews(chunks)
        expect(result.summary).toContain("**Changes requested**")
      })

      it("includes comment count in summary header", () => {
        const chunks = [
          createChunkResult({
            summary: "Section 1",
            comments: [createComment(), createComment({ file: "b.ts" })],
          }),
          createChunkResult({
            summary: "Section 2",
            comments: [createComment({ file: "c.ts" })],
          }),
          createChunkResult({ summary: "Section 3" }),
        ]
        const result = aggregateChunkReviews(chunks)
        expect(result.summary).toContain("3 comment(s)")
      })
    })
  })

  describe("isStateStale", () => {
    it("returns false when SHA matches", () => {
      const state = createReviewState({ headSha: "abc123" })
      expect(isStateStale(state, "abc123")).toBe(false)
    })

    it("returns true when SHA differs", () => {
      const state = createReviewState({ headSha: "abc123" })
      expect(isStateStale(state, "def456")).toBe(true)
    })
  })

  describe("getIncompleteChunks", () => {
    it("returns pending chunks", () => {
      const state = createReviewState({
        chunks: [
          createChunkState({ status: "pending" }),
          createChunkState({ status: "completed" }),
        ],
      })
      const incomplete = getIncompleteChunks(state)
      expect(incomplete).toHaveLength(1)
      expect(incomplete[0]?.status).toBe("pending")
    })

    it("returns in_progress chunks", () => {
      const state = createReviewState({
        chunks: [
          createChunkState({ status: "in_progress" }),
          createChunkState({ status: "completed" }),
        ],
      })
      const incomplete = getIncompleteChunks(state)
      expect(incomplete).toHaveLength(1)
      expect(incomplete[0]?.status).toBe("in_progress")
    })

    it("returns failed chunks", () => {
      const state = createReviewState({
        chunks: [
          createChunkState({ status: "failed", error: "API error" }),
          createChunkState({ status: "completed" }),
        ],
      })
      const incomplete = getIncompleteChunks(state)
      expect(incomplete).toHaveLength(1)
      expect(incomplete[0]?.status).toBe("failed")
    })

    it("returns empty for all completed", () => {
      const state = createReviewState({
        chunks: [
          createChunkState({ status: "completed" }),
          createChunkState({ status: "completed" }),
        ],
      })
      const incomplete = getIncompleteChunks(state)
      expect(incomplete).toHaveLength(0)
    })
  })

  describe("getCompletedChunks", () => {
    it("returns results from completed chunks", () => {
      const result1 = createChunkResult({ groupId: "g1" })
      const result2 = createChunkResult({ groupId: "g2" })
      const state = createReviewState({
        chunks: [
          createChunkState({ status: "completed", result: result1 }),
          createChunkState({ status: "pending" }),
          createChunkState({ status: "completed", result: result2 }),
        ],
      })
      const completed = getCompletedChunks(state)
      expect(completed).toHaveLength(2)
      expect(completed[0]?.groupId).toBe("g1")
      expect(completed[1]?.groupId).toBe("g2")
    })

    it("excludes completed chunks without result", () => {
      const state = createReviewState({
        chunks: [
          createChunkState({ status: "completed" }), // No result
          createChunkState({ status: "completed", result: createChunkResult() }),
        ],
      })
      const completed = getCompletedChunks(state)
      expect(completed).toHaveLength(1)
    })

    it("returns empty for no completed chunks", () => {
      const state = createReviewState({
        chunks: [
          createChunkState({ status: "pending" }),
          createChunkState({ status: "in_progress" }),
        ],
      })
      const completed = getCompletedChunks(state)
      expect(completed).toHaveLength(0)
    })
  })

  describe("createInitialState", () => {
    it("creates state with correct metadata", () => {
      const groups = [createFileGroup({ id: "g1" }), createFileGroup({ id: "g2" })]
      const state = createInitialState(
        { owner: "myorg", repo: "myrepo" },
        { number: 42 },
        "sha123",
        [],
        groups
      )

      expect(state.version).toBe(1)
      expect(state.owner).toBe("myorg")
      expect(state.repo).toBe("myrepo")
      expect(state.prNumber).toBe(42)
      expect(state.headSha).toBe("sha123")
    })

    it("creates pending chunk for each group", () => {
      const groups = [
        createFileGroup({ id: "g1", name: "Auth" }),
        createFileGroup({ id: "g2", name: "API" }),
      ]
      const state = createInitialState(
        { owner: "o", repo: "r" },
        { number: 1 },
        "sha",
        [],
        groups
      )

      expect(state.chunks).toHaveLength(2)
      expect(state.chunks[0]?.status).toBe("pending")
      expect(state.chunks[0]?.group.name).toBe("Auth")
      expect(state.chunks[1]?.status).toBe("pending")
      expect(state.chunks[1]?.group.name).toBe("API")
    })

    it("preserves files in state", () => {
      const files = [
        { path: "a.ts", contentPreview: "...", diffPreview: "...", fullDiff: "..." },
      ]
      const state = createInitialState(
        { owner: "o", repo: "r" },
        { number: 1 },
        "sha",
        files,
        []
      )

      expect(state.files).toHaveLength(1)
      expect(state.files[0]?.path).toBe("a.ts")
    })

    it("sets timestamps", () => {
      const before = new Date().toISOString()
      const state = createInitialState(
        { owner: "o", repo: "r" },
        { number: 1 },
        "sha",
        [],
        []
      )
      const after = new Date().toISOString()

      expect(state.startedAt >= before).toBe(true)
      expect(state.startedAt <= after).toBe(true)
      expect(state.updatedAt).toBe(state.startedAt)
    })
  })
})
