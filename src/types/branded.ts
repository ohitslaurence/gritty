import { Brand } from "effect"

/**
 * Branded type for commit message content.
 * Ensures type safety when passing commit messages around.
 */
export type CommitMessage = string & Brand.Brand<"CommitMessage">
export const CommitMessage = Brand.nominal<CommitMessage>()

/**
 * Branded type for git diff content.
 * Ensures type safety when passing diff content around.
 */
export type DiffContent = string & Brand.Brand<"DiffContent">
export const DiffContent = Brand.nominal<DiffContent>()

/**
 * Branded type for file paths.
 */
export type FilePath = string & Brand.Brand<"FilePath">
export const FilePath = Brand.nominal<FilePath>()

/**
 * Branded type for branch names.
 */
export type BranchName = string & Brand.Brand<"BranchName">
export const BranchName = Brand.nominal<BranchName>()
