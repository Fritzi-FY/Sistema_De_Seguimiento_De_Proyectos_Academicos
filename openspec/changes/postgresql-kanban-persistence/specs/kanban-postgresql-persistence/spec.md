## ADDED Requirements

### Requirement: Durable Kanban through existing ports

The system SHALL persist boards, columns, tasks, responsible users and immutable task activity in PostgreSQL when postgres mode is selected, using the existing ports and public contracts. Memory mode SHALL retain Maps for current tests; postgres mode SHALL NOT silently fall back to memory or mix persisted tasks with volatile activity.

#### Scenario: Persistence after API restart

- **GIVEN** committed board configuration, an assigned task and its activity in an isolated PostgreSQL database
- **WHEN** the API process stops and a new process connects to that same database
- **THEN** IDs, fields, assignments, column/task order and activity SHALL remain unchanged and queryable under the existing permissions

#### Scenario: Memory mode remains available

- **GIVEN** the current Maps test configuration
- **WHEN** existing Kanban tests execute
- **THEN** they SHALL remain deterministic and SHALL require no PostgreSQL or remote service

#### Scenario: Preserve ordered repeated responsible users

- **GIVEN** a valid responsible-user list containing eligible users in a specified order, including repeated identifiers accepted by Maps
- **WHEN** a task is created or edited in PostgreSQL mode and the API and database are restarted
- **THEN** reads SHALL preserve the exact list order and repetitions, together with immutable activity details
- **AND** filtering by one responsible user SHALL return each task once

### Requirement: Additive recoverable schema and least privilege

The existing migrator SHALL introduce version 3 additively without altering applied SQL/checksums. It SHALL verify schema and effective ACL according to the observed migration version. Runtime SHALL NOT update/delete activity or access the migration ledger.

#### Scenario: Upgrade from version 2

- **GIVEN** version 2 with synthetic projects, memberships and teacher assignments
- **WHEN** the reviewed migration is applied to that isolated fixture
- **THEN** existing data SHALL remain intact, version 3 SHALL be recorded atomically and a subsequent plan SHALL have no pending migrations
- **AND** version 3 checks SHALL reject missing expected tables or excess privileges

#### Scenario: Failed or uncertain migration

- **GIVEN** a migration failure or an unconfirmed COMMIT
- **WHEN** the runner stops and another session observes only earlier versions
- **THEN** evidence and the uncertain-attempt block SHALL be preserved without automatic reapplication or a historical rollback-confirmed claim

### Requirement: Atomic task mutations and contiguous order

SQL creation, editing, movement and column reallocation SHALL preserve the existing all-or-nothing guarantees: state, assignees, contiguous zero-based order and their activity SHALL commit together. Destination clamping and idempotent no-op behavior SHALL remain unchanged.

#### Scenario: Create and edit

- **GIVEN** an authorized member, a valid project column and eligible responsible users
- **WHEN** a task is created and subsequently edited
- **THEN** creation SHALL atomically append the task and one CREATED event
- **AND** a real edit SHALL atomically update the requested fields and one UPDATED event while preserving identity and movement-only fields

#### Scenario: Concurrent movement and clamping

- **GIVEN** two API instances sharing a project database
- **WHEN** authorized members move tasks concurrently within or between its columns, including an index beyond the destination length
- **THEN** successful operations SHALL serialize consistently, clamp as specified and leave contiguous unique positions without lost/duplicated tasks
- **AND** each effective move SHALL have exactly one MOVED event

#### Scenario: No-op and failure before commit

- **GIVEN** a no-op update/move or an injected failure between state persistence and activity insertion
- **WHEN** the operation finishes or fails with rollback confirmed
- **THEN** a no-op SHALL preserve timestamps and emit no activity
- **AND** the failed transaction SHALL leave no partial state, reordering or orphan activity

#### Scenario: Column deletion with reallocation

- **GIVEN** the existing minimum/maximum column rules and a column containing tasks
- **WHEN** an authorized member deletes it with a valid destination under the current contract
- **THEN** task reallocation, contiguous task/column ordering, required activity and deletion SHALL be atomic
- **AND** a last-column deletion or invalid destination SHALL leave state and history unchanged

### Requirement: Preserve project permissions and eligible assignments

SQL adapters SHALL preserve the permissions of each existing endpoint, horizontal isolation and active-membership eligibility checks. Mutation-time actor/assignee validation SHALL be coordinated with membership retirement in the database, not only checked before the transaction. No teacher or membership permission SHALL be expanded by selecting PostgreSQL.

#### Scenario: Invalid assignment or cross-project destination

- **GIVEN** an unauthorized requester, a removed/non-member assignee or a column belonging to another project
- **WHEN** creation, editing or movement is requested
- **THEN** the existing error contract SHALL apply without disclosing another project's data or persisting state/activity changes

#### Scenario: Assignment races with retirement

- **GIVEN** concurrent retirement and an assignment attempt for the same project member
- **WHEN** the transactions acquire their database locks
- **THEN** eligibility SHALL be decided consistently with their serialization order
- **AND** retirement confirmed before assignment validation SHALL prevent that assignment without partial task/activity changes

### Requirement: Stable SQL reads and immutable history

SQL listing SHALL preserve existing AND filters, literal case-insensitive substring search, default/maximum page sizes and ordering by columnId, orderIndex and createdAt. Page and total SHALL describe one consistent snapshot. History SHALL preserve immutable event details and its existing timestamp/id ordering, including references to deleted columns.

#### Scenario: Read after mutation and column deletion

- **GIVEN** committed changes and an authorized reader
- **WHEN** another API instance reads a filtered page or task history, including after a column was reallocated/deleted
- **THEN** it SHALL observe the committed state, accurate totals and retained events under the current access rules without recording read events

#### Scenario: Unconfirmed task COMMIT or failed closure

- **GIVEN** a lost COMMIT response or a closure failure after a confirmed COMMIT
- **WHEN** the application reports the operation and an independent session observes current state
- **THEN** transactional outcome, transport and closure SHALL remain distinct
- **AND** an uncertain mutation SHALL NOT be retried or reclassified as a historical confirmed rollback from the observed state alone
