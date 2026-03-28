# Agentic Release Management Design

**Date:** 2026-03-28

## Goal

Automatically evaluate every merged PR for release-worthiness, let the configured agent decide whether a release should be created and what semver bump it should use, and publish a GitHub release with agent-authored notes when appropriate. Expose the full workflow in a dedicated release management page.

## Decision Summary

- Trigger release evaluation for every merged PR detected by the watcher.
- Use the configured coding agent (`claude` or `codex`) to decide:
  - whether to create a release
  - the semver bump: `patch`, `minor`, or `major`
  - the release title and release notes
- Keep irreversible operations deterministic in the app:
  - merge confirmation
  - latest-tag lookup
  - next-version calculation
  - GitHub release creation
  - idempotency and retries
- Add a dedicated `/releases` page for release history and operational state.
- Add a single global config toggle to disable automatic release creation if needed.

## Existing Constraints

- The watcher currently infers close state by comparing tracked PRs with GitHub open PRs and archiving PRs that disappear from the open list.
- Archived PRs are not currently distinguished as merged vs closed-without-merge.
- The codebase already has a durable async artifact pattern with social changelogs:
  - watcher detects a merged-PR condition
  - storage persists a background job/result
  - a dedicated page renders status/history
- Published GitHub releases already trigger downstream workflows in this repository:
  - npm publish
  - Tauri release builds

## Proposed Architecture

### 1. ReleaseRun as a first-class entity

Add a durable `ReleaseRun` record to store the full release automation lifecycle.

Suggested fields:

- `id`
- `repo`
- `baseBranch`
- `triggerPrNumber`
- `triggerPrTitle`
- `triggerPrUrl`
- `triggerMergeSha`
- `triggerMergedAt`
- `status`
- `decisionReason`
- `recommendedBump`
- `proposedVersion`
- `releaseTitle`
- `releaseNotes`
- `includedPrs`
- `targetSha`
- `githubReleaseId`
- `githubReleaseUrl`
- `error`
- `createdAt`
- `updatedAt`
- `completedAt`

Suggested statuses:

- `detected`
- `evaluating`
- `skipped`
- `proposed`
- `publishing`
- `published`
- `error`

### 2. Merge confirmation in the watcher

Extend the watcher flow so that when a tracked PR disappears from GitHub open PRs, the server fetches the full PR state and confirms whether it was merged before treating it as a release trigger.

If the PR was merged:

- archive the PR locally as today
- create or reconcile a `ReleaseRun` keyed by repo + trigger PR number + merge SHA
- kick off background processing for that run

If the PR was only closed:

- archive the PR locally
- do not create a release run

### 3. Dedicated release manager

Add a small service layer that owns:

- run creation
- state transitions
- repo-level locking
- idempotency checks
- agent evaluation
- version calculation
- GitHub release creation

The watcher should detect events, but the release manager should own the release workflow.

### 4. Agent boundary

The agent should return structured JSON only. It does not call GitHub and it does not invent the final version string directly.

Suggested evaluation output:

```json
{
  "shouldRelease": true,
  "reason": "User-facing feature that changes release behavior.",
  "bump": "minor",
  "title": "Release management automation",
  "notes": "## Highlights\n..."
}
```

The app validates this output, computes the next version deterministically from the latest semver tag, and publishes the release through GitHub APIs.

### 5. Versioning model

- Fetch the latest semver tag from GitHub for the repository.
- Default the starting point to `v0.1.0` semantics if no prior release exists.
- Apply the agent-selected bump to compute the next version.
- Reject invalid or non-semver tags as candidates for automatic bumping.

### 6. Release scope

One merged PR triggers evaluation, but the published release should contain all unreleased merged PRs on the release branch since the last published release.

That lets the agent answer the right question:

- not just “is this PR alone worthy of a release?”
- but “given the current unreleased changes, should we publish a release now?”

The `ReleaseRun` stores both:

- the trigger PR
- the final included PR summaries

### 7. GitHub integration

Add server helpers to:

- fetch full PR close/merge state
- list published releases
- list tags
- determine the latest semver release/tag
- list merged PRs since the last release target
- create a GitHub release

Prefer GitHub release creation over raw git tagging because this repository already has release workflows wired to GitHub release publication events.

### 8. UI

Add a new `/releases` page with:

- release-run history cards
- status badges
- trigger PR and included PR list
- chosen bump and proposed/published version
- decision rationale
- release notes preview
- GitHub link for published releases
- retry action for failed runs

This page should follow the current `changelogs` page pattern:

- list-first history surface
- adaptive polling while runs are active
- expandable details
- empty/loading/error states

### 9. Configuration

Add one global config flag:

- `autoCreateReleases: boolean`

This is an emergency stop for release publishing while keeping the rest of the feature model simple for v1.

## Error Handling

- If merge confirmation fails, do not create a release run.
- If agent evaluation fails, mark the run `error`.
- If the agent returns invalid JSON, mark the run `error`.
- If version calculation fails due to malformed existing tags, mark the run `error`.
- If the release/tag already exists, reconcile instead of publishing a duplicate.
- If GitHub release creation fails, mark the run `error` with the API error.

## Testing Strategy

- Schema/model validation tests for `ReleaseRun`.
- Storage tests for create/list/update/idempotent lookup.
- GitHub helper tests for:
  - merge confirmation parsing
  - latest semver tag selection
  - next-version calculation
  - release creation request shape
- Release manager tests for:
  - merged PR creates a run
  - closed-unmerged PR does not
  - skipped decision
  - successful publish
  - duplicate merge/retry reconciliation
- Route tests for release APIs.
- UI smoke coverage for release page rendering and polling behavior.

## Out of Scope for V1

- Per-repo release policies
- Manual version overrides
- Approval queue before publish
- Multiple release branches per repo
- Editing release notes in the app before publishing
- Draft releases
- Release rollback tooling
