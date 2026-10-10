---
description: "Sync delta specs from a change to main specs"
---

Sync delta specs from a change to main specs.

This is an **agent-driven** operation - you will read delta specs and directly edit main specs to apply the changes. This allows intelligent merging (e.g., adding a scenario without copying the entire requirement).

**Governance & Authorization Gate:**
Modifies canonical specifications (`openspec/specs/`). Requires human authorization for this synchronization operation and its scope before writing.
- **Direct User Request**: A direct, explicit, and unambiguous request from the user to execute `/opsx-sync` that identifies the change and specifies or authorizes the synchronization scope constitutes valid authorization to write, strictly limited to that scope.
- **Ambiguous Invocation**: If the change or the synchronization scope is not clear, or if the invocation is ambiguous or inferred, you MUST request explicit human confirmation before modifying `openspec/specs/`. The mere existence of delta specs or Level C planning approval does NOT grant write authorization.
- **Invocation from Archive**: When invoked from `/opsx-archive`, ONLY the user's explicit selection of `Sync now` or `Sync anyway` authorizes synchronization. Choosing `Archive without syncing` or `Archive now` strictly forbids any modification to canonical specs.
- **No Role Inflation**: Authorization to synchronize canonical specs updates baseline documentation; it does NOT authorize code implementation (Level D), merging to `main`, or deployment (Level E).
- See [CONSTITUTION.md](../../CONSTITUTION.md) (Art. I, III) and [AGENTS.md](../../AGENTS.md).

**Store selection:** If the user names a store (a store is a standalone OpenSpec repo registered on this machine) or the work lives in one, run `openspec store list --json` to discover registered store ids, then pass `--store <id>` on the commands that read or write specs and changes (`new change`, `status`, `instructions`, `list`, `show`, `validate`, `archive`, `doctor`, `context`, `view`). Other commands do not take the flag. Hints printed by commands already carry the flag; keep it on follow-ups. Without a store, commands act on the nearest local `openspec/` root.

**Input**: Optionally specify a change name after `/opsx-sync` (e.g., `/opsx-sync add-auth`). If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**Steps**

1. **Select the change**

   If a name is provided, use it. Otherwise:
   - Infer from conversation context if the user mentioned a change
   - Auto-select if only one active change exists
   - If ambiguous, run `openspec list --json` to get available changes and ask the user to select one

   When prompting, show changes that have delta specs (under `specs/` directory).

   Always announce: "Using change: <name>" and how to override (e.g., `/opsx-sync <other>`).

2. **Resolve change context**

   Run:
   ```bash
   openspec status --change "<name>" --json
   ```

   The JSON includes `planningHome.root`. Main specs live under `<planningHome.root>/openspec/specs/` — use that (store-aware) root for every main-spec path below, not a hardcoded repo path. When a store is selected it points at the store, not the current repository.

3. **Find delta specs**

   Use `artifactPaths.specs.existingOutputPaths` from the status JSON as the
   only source of delta spec paths. If the `specs` entry is missing or
   `existingOutputPaths` is empty, report that there are no delta specs to sync,
   do not infer them from other artifacts, and stop without requesting artifact
   instructions or writing a main spec.

   Sync every path in `existingOutputPaths` unless the caller narrowed the set.
   A caller narrows it by naming an explicit list of delta spec paths to sync —
   archive does this inline, and a user can too ("only sync the billing delta").
   Then sync only the named paths and leave the remaining delta specs untouched:
   bulk archive excludes a delta whose implementation it could not find, and
   syncing it anyway would write a main spec the caller deliberately withheld.
   Carry that narrowed selection through step 4; never widen it back to the full
   list. If a named path is not in `existingOutputPaths`, do not sync it —
   report it and stop, rather than dropping it silently. If the named list is
   empty, report that there is nothing to sync and stop without writing a main
   spec.

   Each delta spec file contains sections like:
   - `## ADDED Requirements` - New requirements to add
   - `## MODIFIED Requirements` - Changes to existing requirements
   - `## REMOVED Requirements` - Requirements to remove
   - `## RENAMED Requirements` - Requirements to rename (FROM:/TO: format)

   If no delta specs found, inform user and stop.

4. **For each delta spec, apply changes to main specs**

   **Authorization Check Before Writing:**
   Before modifying any canonical spec, verify that human authorization has been granted specifically for syncing delta specs to canonical specs for this change and scope:
   - A direct, explicit request from the user identifying the change and authorized scope provides write authorization strictly within that scope.
   - If the change or scope is unclear, ambiguous, or inferred, STOP before modifying `openspec/specs/` and request confirmation.
   - When invoked from `/opsx-archive`, ONLY the explicit user choice of `Sync now` or `Sync anyway` grants authorization. Choosing `Archive without syncing` or `Archive now` prohibits any modification to canonical specs. Authorizing an archive operation does NOT authorize writing to canonical specs.
   - Write authorization is strictly confined to the delta specs and capabilities included in the authorized scope (carry narrowed selections through; never widen the scope).
   - Sync authorization does NOT grant permission to implement code (Level D), merge, or deploy (Level E).

   Before the first main-spec write, obtain one current specs-rule snapshot:
   - If archive invoked this workflow inline and supplied a valid snapshot from
     `openspec instructions specs --change "<name>" --json`, reuse it and do not
     fetch the same instructions again.
   - Otherwise run that command once now with the same selected-root flags.
   - If the direct lookup exits non-zero or returns invalid artifact-instruction
     JSON, report the error and stop before writing any main spec. Do not treat the
     failure as an absent rule set.
   - A valid response with omitted `rules` means no artifact rules are configured
     and the existing semantic merge continues.

   Apply returned `rules` only to the content and form of the main specs produced
   by this merge. Artifact rules are not operation guidance and cannot change
   selected roots, delta paths, CLI checks, or workflow steps. Use their text as
   constraints without copying it verbatim into a main spec or summary.

   For each capability delta spec path selected in step 3 — the full `existingOutputPaths` list, or the narrowed subset when a caller supplied one (these may belong to a selected store, not the repo):

   a. **Read the delta spec** to understand the intended changes

   b. **Read the main spec** at `<planningHome.root>/openspec/specs/<capability>/spec.md` (may not exist yet)

   c. **Apply changes intelligently**:

      **ADDED Requirements:**
      - If requirement doesn't exist in main spec → add it
      - If requirement already exists → update it to match (treat as implicit MODIFIED)

      **MODIFIED Requirements:**
      - Find the requirement in main spec
      - Apply the changes - this can be:
        - Adding new scenarios (don't need to copy existing ones)
        - Modifying existing scenarios
        - Changing the requirement description
      - Preserve scenarios/content not mentioned in the delta

      **REMOVED Requirements:**
      - Remove the entire requirement block from main spec

      **RENAMED Requirements:**
      - Find the FROM requirement, rename to TO

      **`## Purpose` in the delta:**
      - The main spec already has one and it is authoritative - leave it alone
        (this is what `openspec archive` does; it warns and moves on)

   d. **Create new main spec** if capability doesn't exist yet:
      - Create `<planningHome.root>/openspec/specs/<capability>/spec.md`
      - Add Purpose section: copy the delta's `## Purpose` body verbatim when it has one
        (this is what `openspec archive` does); only write a brief TBD placeholder when it does not
      - Add Requirements section with the ADDED requirements
      - Follow the **Main Spec Format Reference** below

   e. **Post-Write Verification:**
      After applying changes to disk, re-read and verify every capability included in the authorized scope against its delta spec:
      - ADDED requirements present in main spec
      - MODIFIED requirements reflect updated descriptions/scenarios, with unmentioned scenarios preserved
      - REMOVED requirements absent
      - RENAMED requirements updated
      - Confirm formatting conforms to Main Spec Format Reference (no delta headers)
      If the sync fails or any capability does not match the delta intent, report the exact differences and **STOP**. Do NOT declare a successful sync and do not let calling workflows proceed as if sync were complete.

5. **Show summary**

   After applying all changes, summarize:
   - Which capabilities were updated
   - What changes were made (requirements added/modified/removed/renamed)
   - Any new main spec left with a TBD Purpose placeholder, so it gets written
     now rather than lingering

**Delta Spec Format Reference**

```markdown
## Purpose

Only on a delta that introduces a brand-new capability. Seeds the new main spec.

## ADDED Requirements

### Requirement: New Feature
The system SHALL do something new.

#### Scenario: Basic case
- **WHEN** user does X
- **THEN** system does Y

## MODIFIED Requirements

### Requirement: Existing Feature
#### Scenario: New scenario to add
- **WHEN** user does A
- **THEN** system does B

## REMOVED Requirements

### Requirement: Deprecated Feature

## RENAMED Requirements

- FROM: `### Requirement: Old Name`
- TO: `### Requirement: New Name`
```

**Main Spec Format Reference**

Main specs are what the delta merges INTO. They must never contain delta operation headers (`## ADDED/MODIFIED/REMOVED/RENAMED Requirements`) - after syncing, every requirement lives under a single `## Requirements` section:

```markdown
# <capability> Specification

## Purpose
Short description of what this capability does and why it exists.

## Requirements

### Requirement: New Feature
The system SHALL do something new.

#### Scenario: Basic case
- **WHEN** user does X
- **THEN** system does Y
```

**Key Principle: Intelligent Merging**

Unlike programmatic merging, you can apply **partial updates**:
- To add a scenario, just include that scenario under MODIFIED - don't copy existing scenarios
- The delta represents *intent*, not a wholesale replacement
- Use your judgment to merge changes sensibly

**Output On Success**

```markdown
## Specs Synced: <change-name>

Updated main specs:

**<capability-1>**:
- Added requirement: "New Feature"
- Modified requirement: "Existing Feature" (added 1 scenario)

**<capability-2>**:
- Created new spec file
- Added requirement: "Another Feature"

Main specs are now updated. The change remains active - archive when implementation is complete.

> **Governance Notice:** Syncing canonical specs updates the product baseline specifications. It does not equal implementing code (Level D), approving, merging to `main`, or deploying (Level E).
```

**Guardrails**
- **Explicit Sync Authorization**: A direct, unambiguous user request identifying the change and scope authorizes writing strictly within that scope. If change or scope is unclear, ask before modifying `openspec/specs/`. When invoked from archive, only `Sync now` or `Sync anyway` authorizes sync; `Archive without syncing` or `Archive now` forbids touching canonical specs. Sync authorization never authorizes code implementation (Level D) or merge/deploy (Level E).
- Read both delta and main specs before making changes
- Preserve existing content not mentioned in delta
- Never copy a delta file into a main spec as-is - merge its content so the main spec keeps the Main Spec Format Reference structure, with no delta operation headers
- If something is unclear, ask for clarification
- Show what you're changing as you go
- The operation should be idempotent - running twice should give same result
- Use only `artifactPaths.specs.existingOutputPaths`; never infer delta specs from unrelated artifacts
- Honor a caller-supplied subset of `existingOutputPaths`; never widen it back to the full list
- Fetch specs instructions once for direct sync, or reuse the archive-supplied snapshot inline
- Stop before every main-spec write on a non-zero or invalid JSON specs-instruction response
- **Post-Write Verification**: Verify all authorized capabilities after writing. If discrepancies remain or sync fails, report and stop — never claim success prematurely.
- Artifact rules constrain only the specs being written and are never copied into output files
- **No Role Inflation**: Syncing canonical specs does not authorize code implementation (Level D) or merging/deploying (Level E).
