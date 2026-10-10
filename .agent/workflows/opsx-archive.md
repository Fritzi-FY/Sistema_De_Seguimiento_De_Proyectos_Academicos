---
description: "Archive a completed change in the experimental workflow"
---

Archive a completed change in the experimental workflow.

**Governance & Lifecycle Notice:**
Archiving is an OpenSpec lifecycle operation that organizes and moves a change folder to the archive directory.
- Archiving does **NOT** certify that implementation is complete, that tests have passed, or that code is ready to merge or deploy.
- Integration, merging to `main`, and deployment require explicit **Level E** human authorization, green CI pipeline, and PR review checklist ([CONSTITUTION.md](../../CONSTITUTION.md) Art. III, V, VII; [AGENTS.md](../../AGENTS.md)).

**Store selection:** If the user names a store (a store is a standalone OpenSpec repo registered on this machine) or the work lives in one, run `openspec store list --json` to discover registered store ids, then pass `--store <id>` on the commands that read or write specs and changes (`new change`, `status`, `instructions`, `list`, `show`, `validate`, `archive`, `doctor`, `context`, `view`). Other commands do not take the flag. Hints printed by commands already carry the flag; keep it on follow-ups. Without a store, commands act on the nearest local `openspec/` root.

**Input**: Optionally specify a change name after `/opsx-archive` (e.g., `/opsx-archive add-auth`). If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**Steps**

1. **Select the change**

   If a name is provided, use it. Otherwise:
   - Infer from conversation context if the user mentioned a change
   - Auto-select if only one active change exists
   - If ambiguous, run `openspec list --json` to get available changes and ask the user to select one

   When prompting, show only active changes (not already archived).
   Include the schema used for each change if available.

   Always announce: "Using change: <name>" and how to override (e.g., `/opsx-archive <other>`).

   **Load current archive inputs before the existing archive checks:**

   After resolving the selected change and planning root, run:
   ```bash
   openspec instructions archive --change "<name>" --json
   ```
   Keep the same selected-root flags on this command. This lookup is advisory and
   optional: it only supplies extra prompt inputs, so it must never block archiving.
   If it exits non-zero or returns invalid JSON — for example on an older CLI that
   does not support this command yet — continue the archive workflow with no
   context and no operation guidance. Do not report an error and do not stop.

   A successful response may omit both optional fields. Treat `context` as a
   required prompt-level input: read and consider it, and apply relevant project
   facts, conventions, and constraints. Treat `operationGuidance` as optional
   additive advice: read and consider every entry, and follow entries that are
   applicable and compatible with the built-in archive workflow.

   Keep both fields separate from built-in steps, explicit user choices, resolved
   paths, CLI checks, and command contracts. If context conflicts with one of those
   controlling inputs, report the conflict and preserve the controlling value. If
   guidance is inapplicable or conflicts with a controlling input, do not follow it
   and explain why. Do not infer replacement paths, skipped prompts, or flags from
   either field, and do not copy their text verbatim into specs, change artifacts,
   or archive summaries unless the user separately asks for it. These are
   prompt-level behavior contracts, not enforceable checks.

2. **Check artifact completion status**

   Run `openspec status --change "<name>" --json` to check artifact completion.

   Parse the JSON to understand:
   - `schemaName`: The workflow being used
   - `planningHome`, `changeRoot`, `artifactPaths`, and `actionContext`: path and scope context
   - `artifacts`: List of artifacts with their status (`done`, `skipped`, or other)

   **If any artifacts are neither `done` nor `skipped`** (skipped artifacts satisfy the requirement - the change declares skip_specs):
   - Display warning listing incomplete artifacts
   - Prompt user for confirmation to continue
   - Proceed if user confirms

3. **Check task completion and test verification status**

   - **Check pending tasks**: Read the tasks file (typically `tasks.md`) to check for incomplete tasks. Count tasks marked with `- [ ]` (incomplete) vs `- [x]` (complete). Never mark a task as completed based solely on its description.
   - **Check test verification evidence**: Do NOT assume that `tasks.md` verifies test results. Use `tasks.md` strictly to check pending tasks. Consider tests verified ONLY when real, accessible evidence of their execution and passing results exists (such as actual test suite outputs, command results, or verification logs). Tasks marked `[x]` do not alone prove that tests have passed.
   - **Report unverified tests**: If no real evidence of test execution exists, report explicitly that tests are unverified. **NEVER** fabricate test results or convert unverified checks or warnings into successes ([CONSTITUTION.md](../../CONSTITUTION.md) Art. V).

   **If incomplete tasks or unverified tests are found:**
   - Accurately display the count of incomplete tasks (`<pending-task-count>`) and report unverified tests.
   - Display explicit warning: archiving does NOT certify task completion, test pass, or readiness for merge/deploy.
   - **Dedicated Warning Confirmation Required**: Prompt the user for explicit confirmation where the user clearly indicates that they accept continuing to archive despite these warnings (e.g., asking specifically whether they accept continuing to archive despite pending tasks and/or unverified tests). A previous confirmation to continue the workflow (such as from Step 2 for incomplete artifacts, or a general invocation) must NOT be considered automatic acceptance of these task or test warnings.
   - Proceed with warnings ONLY if the user explicitly confirms acceptance of continuing to archive despite these specific warnings (preserving the existing policy that archiving with warnings is allowed after explicit confirmation).

   **If no tasks file exists:**
   - Mark task status as **unverifiable** (`no verificable`). Do NOT assume or affirm that all tasks are complete without sufficient evidence.
   - Check for test verification evidence and report if unverified.
   - Display explicit warning that task completion cannot be verified.
   - Prompt the user for explicit confirmation clearly indicating that they accept continuing to archive despite unverifiable task status and unverified tests. Proceed with warnings ONLY if the user explicitly confirms acceptance.

4. **Assess delta spec sync state**

   Use `artifactPaths.specs.existingOutputPaths` from status JSON as the only
   delta-spec source. If the `specs` entry is missing or
   `existingOutputPaths` is empty, proceed without a sync prompt and do not infer
   delta specs from other artifacts.

   **If delta specs exist:**
   - Compare each delta spec with its corresponding main spec at `<planningHome.root>/openspec/specs/<capability>/spec.md` (use the store-aware `planningHome.root` from step 2, not a hardcoded repo path)
   - Determine what changes would be applied (adds, modifications, removals, renames)
   - Show a combined summary before prompting

   **Governance & Scope Rule for Sync:**
   Authorizing the archiving of a change does **NOT** automatically authorize writing to canonical specs (`openspec/specs/`).
   - Modifying canonical specs requires an explicit human choice to synchronize ("Sync now" or "Sync anyway").
   - That authorization is strictly limited to the delta specs and capabilities included in the selected scope.
   - If the user chooses to archive without syncing ("Archive without syncing" or "Archive now"), canonical specs **MUST NOT** be modified; proceed directly to step 5 without running the sync or altering main specs.

   **Prompt options:**
   - If changes needed: "Sync now (recommended)", "Archive without syncing"
   - If already synced: "Archive now", "Sync anyway", "Cancel"

   Route on the answer:
   - "Cancel" — stop, do not archive
   - "Archive without syncing" or "Archive now" — proceed to archive directly (do NOT modify canonical specs; main specs remain untouched)
   - "Sync now" or "Sync anyway" — explicit authorization to sync is granted strictly for the selected delta specs/capabilities; sync, then verify (below)
   - Anything else — ask again rather than archiving

   Before a selected sync writes any main spec, run
   `openspec instructions specs --change "<name>" --json` once with the same
   selected-root flags. Require a zero exit status and valid artifact-instruction
   JSON. If the lookup fails or returns invalid JSON, report the error and stop
   before writing any main spec or moving the change. A valid response with omitted
   `rules` is the no-rules case. Apply returned `rules` only to the content and
   form of main specs produced by this merge; do not use them as archive guidance,
   change CLI behavior, or copy the rule text into any output file.

   Then run the `/opsx-sync` workflow inline (agent-driven intelligent merge) for change '<name>', passing the delta spec analysis and the fetched specs-rule snapshot from above, and wait for it to finish. The inline sync must reuse that snapshot without fetching `specs` instructions again. Do not delegate it to a background task — step 5 would move `changeRoot` out from under a sync that is still reading it, leaving the change archived and the main specs never updated. If your agent can only run it by delegation, delegate synchronously and wait for the result.

   Then re-run the comparison from the top of this step against every capability that has a delta spec in `artifactPaths.specs.existingOutputPaths` — not only the ones the sync reports it touched. A successful sync leaves nothing left to apply, so each capability must now read as already synced:
   - ADDED requirements present
   - MODIFIED requirements carrying the scenario and description changes named in the delta, with their other scenarios intact
   - REMOVED requirements gone
   - RENAMED requirements present under the new name and absent under the old one

   If the sync failed, or any capability does not match, report what differs and stop — do not archive. Nothing has moved and `changeRoot` is intact, so the user can fix the mismatch or re-run the sync and start the archive again.

5. **Perform the archive**

   Create an `archive` directory under `planningHome.changesDir` if it doesn't exist:
   ```bash
   mkdir -p "<planningHome.changesDir>/archive"
   ```

   Generate the target name: use the change name as-is when it already starts with a `YYYY-MM-DD-` prefix; otherwise prepend the current date as `YYYY-MM-DD-<change-name>`. Never stack a second date (same rule as `openspec archive`).

   **Check if target already exists:**
   - If yes: Fail with error, suggest renaming existing archive or using different date
   - If no: Move `changeRoot` to the archive directory

   ```bash
   mv "<changeRoot>" "<planningHome.changesDir>/archive/<target-name>"
   ```

6. **Display summary**

   Show archive completion summary distinguishing the archiving operation itself from implementation and test status:
   - Change name
   - Schema that was used
   - Archive location (archive operation succeeded)
   - Spec sync status (reflects what actually occurred: synced / sync skipped / no delta specs)
   - Status breakdown based on real evidence:
     - Planning artifacts status (`<artifact-status>`)
     - Tasks status (`<task-status>`: if no `tasks.md` exists, report as **unverifiable** (`no verificable`); never state all tasks complete without sufficient evidence)
     - Test verification status (`<test-status>`: tasks marked `[x]` do not alone prove tests have passed; require real execution evidence)
   - Detailed warning breakdown when incomplete tasks, unverifiable tasks, or unverified tests exist (using dynamic placeholders like `<pending-task-count>` and `<incomplete-artifact-count>`)

   **Template Selection Rule:**
   - Use the `Output On Success (Fully Complete)` templates ONLY when:
     1. All required planning artifacts are complete (`done` or validly `skipped` by schema).
     2. Task status is verifiable with zero pending tasks (all tasks marked `[x]` in `tasks.md`).
     3. Required tests have accessible evidence of satisfactory execution (passing test outputs, command results, or logs).
   - If any of these conditions is not met, use `Output On Success With Warnings` and report the real status of each element, without claiming that everything is complete or that tests have passed.
   - If no `tasks.md` exists, consider the task status as unverifiable (`no verificable`) and use the warnings template (`Output On Success With Warnings`).
   - Treat spec synchronization as an independent state: skipping spec synchronization does not, by itself, imply that tasks are incomplete or that tests have failed. Report the actual synchronization status in whichever template is selected according to the rules above.

**Output On Success (Fully Complete)**

```markdown
## Archive Complete

**Change:** <change-name>
**Schema:** <schema-name>
**Archived to:** the archive path derived from `planningHome.changesDir`/<target-name>/
**Specs:** <spec-sync-status> (e.g., ✓ Synced to main specs)

Archive operation: Succeeded (change folder moved to archive).

**Status Breakdown (Evidence-Based):**
- Planning artifacts: <artifact-status> (e.g., All planning artifacts complete)
- Implementation tasks: <task-status> (e.g., All tasks marked complete in tasks.md [N/N]; unverifiable if no tasks.md)
- Test verification: <test-status> (e.g., Verified with execution evidence; tasks marked [x] do not alone prove tests passed)

> **Governance Notice:** Archiving moves the change to archive. It does NOT certify that code is deployed, merged, or that all empirical tests passed. Merging to `main` and deploying require explicit Level E human authorization, CI checks, and PR review (CONSTITUTION.md Art. III & VII).
```

**Output On Success (No Delta Specs - Fully Complete)**

```markdown
## Archive Complete

**Change:** <change-name>
**Schema:** <schema-name>
**Archived to:** the archive path derived from `planningHome.changesDir`/<target-name>/
**Specs:** <spec-sync-status> (e.g., No delta specs)

Archive operation: Succeeded (change folder moved to archive).

**Status Breakdown (Evidence-Based):**
- Planning artifacts: <artifact-status> (e.g., All planning artifacts complete)
- Implementation tasks: <task-status> (e.g., All tasks marked complete in tasks.md [N/N]; unverifiable if no tasks.md)
- Test verification: <test-status> (e.g., Verified with execution evidence; tasks marked [x] do not alone prove tests passed)

> **Governance Notice:** Archiving moves the change to archive. It does NOT certify that code is deployed, merged, or that all empirical tests passed. Merging to `main` and deploying require explicit Level E human authorization, CI checks, and PR review (CONSTITUTION.md Art. III & VII).
```

**Output On Success With Warnings**

```markdown
## Archive Complete (with warnings)

**Change:** <change-name>
**Schema:** <schema-name>
**Archived to:** the archive path derived from `planningHome.changesDir`/<target-name>/
**Specs:** <spec-sync-status> (reflects what actually occurred: e.g., "Synced to main specs", "Sync skipped (user chose to skip)", or "No delta specs")

Archive operation: Succeeded (change folder moved to archive).

> Note: The archiving operation succeeded, but this does NOT affirm implementation or test completion. NEVER display all tasks complete when pending tasks, unverifiable tasks, or unverified tests exist.

**Status Breakdown & Warnings:**
- Incomplete tasks: <pending-task-count> tasks remain pending (or "Task status: Unverifiable - no tasks.md found; do not assume tasks are complete")
- Test status: <test-verification-status> (e.g., Unverified - no accessible execution evidence found; tasks marked [x] do not alone prove tests passed)
- Artifact status: <incomplete-artifact-count> incomplete artifacts (or "All planning artifacts complete")
- Delta spec sync: <spec-sync-status> (reflects what actually occurred)

Review the archive if this was not intentional.

> **Governance Notice:** Archiving with warnings records the change in archive, but does NOT certify completion or readiness. The success of the archive operation is strictly distinct from implementation and test status. Never claim tasks are complete or tests passed when warnings exist. Merging to `main` and deploying require explicit Level E human authorization, green CI checks, and PR review (CONSTITUTION.md Art. III & VII).
```

**Output On Error (Archive Exists)**

```markdown
## Archive Failed

**Change:** <change-name>
**Target:** the archive path derived from `planningHome.changesDir`/<target-name>/

Target archive directory already exists.

**Options:**
1. Rename the existing archive
2. Delete the existing archive if it's a duplicate
3. Wait until a different date to archive
```

**Guardrails**
- **Template Selection Rule**: Use `Output On Success (Fully Complete)` templates strictly when all required planning artifacts are complete, task status is verifiable with zero pending tasks, and required tests have accessible evidence of satisfactory execution. If any condition is not met (or if `tasks.md` is missing, rendering task status unverifiable), use `Output On Success With Warnings` reporting the real status of each element without claiming everything is complete or tests passed. Treat spec sync as an independent state: skipping sync does not imply incomplete tasks or failed tests; report actual sync status in the corresponding template.
- **Archive Operation vs. Implementation/Test Status**: Archiving is strictly an OpenSpec lifecycle operation (moving the directory); its success indicates the folder was archived, but does NOT certify that implementation is complete, that tests passed, or that code is ready to merge or deploy.
- **Accurate Output Status**: NEVER display all tasks complete or claim test success as an affirmation of success when pending tasks (`- [ ]`), unverifiable tasks (missing `tasks.md`), or unresolved verifications exist. Distinguish the success of the archiving operation, artifact status, task status, and test status based on real evidence; tasks marked `[x]` do not alone prove tests passed.
- **Unverifiable Tasks Without tasks.md**: If no `tasks.md` exists, task status is unverifiable (`no verificable`). Never affirm or assume all tasks are complete without sufficient evidence.
- **Dedicated Warning Confirmation**: When pending tasks, unverifiable tasks, or unverified tests exist, require explicit user confirmation clearly indicating that they accept continuing to archive despite those warnings. A previous confirmation to continue the workflow (such as from Step 2 for incomplete artifacts, or a general invocation) must NOT be considered automatic acceptance of these task or test warnings.
- **Task and Test Verification**: Use `tasks.md` solely to check pending tasks; do not assume `tasks.md` verifies test results. Consider tests verified ONLY when real, accessible evidence of execution and passing results exists; if none exists, report tests as unverified. Tasks marked `[x]` do not alone prove that tests have passed. Never invent results or mark tasks as completed based solely on their description. Archiving with warnings is permitted only after explicit user confirmation.
- **No Automatic Spec Modification**: Authorization to archive does NOT authorize writing to canonical specs. Only explicit user selection of sync ("Sync now" or "Sync anyway") authorizes writing, strictly limited to the selected delta specs and capabilities. If the user chooses to archive without syncing ("Archive without syncing" or "Archive now"), canonical specs must never be modified.
- **Empirical Truth**: Accurately report incomplete tasks and unverified tests. Never invent test results, ignore pending tasks, or convert warnings into successes.
- **Level E Separation**: Merging to `main` or deploying requires separate Level E human authorization; archiving does not authorize merge/deploy.
- Announce the selected change; prompt for selection when it is ambiguous
- Use artifact graph (openspec status --json) for completion checking
- Don't block archive on warnings - just inform and confirm
- Preserve .openspec.yaml when moving to archive (it moves with the directory)
- Show clear summary of what happened
- If sync is requested, run the `/opsx-sync` workflow inline (agent-driven)
- Never archive while a spec sync is still in flight — run the sync inline and verify the main specs before moving `changeRoot`
- If delta specs exist, always run the sync assessment and show the combined summary before prompting
- Apply relevant runtime context and report conflicts; operation guidance remains advisory
- Consider every guidance entry and explain any inapplicable or conflicting advice
- Existing CLI checks, resolved paths, prompts, and command contracts are unchanged
- Artifact rules constrain only the specs being written and are never operation guidance
- Never copy runtime context, operation guidance, or artifact-rule text verbatim into output files
