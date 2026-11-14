## MODIFIED Requirements

### Requirement: Audit relevant changes

The system SHALL record relevant changes with actor, action, resource identifier, timestamp, and correlation identifier when available.

For the existing Kanban operations that emit `CREATED`, `UPDATED`, `MOVED`, or `COLUMN_DELETED_REALLOCATION` activity, the system SHALL accept an optional `X-Correlation-ID` HTTP header containing a single valid 36-character UUID, normalize it to lowercase, and propagate that accepted identifier as optional `correlationId` through the operation to its persisted activity events and authorized activity responses. A missing or invalid identifier SHALL be omitted without generating a replacement or changing the operation's existing business validation. The system SHALL NOT copy the rejected header value, authentication headers, cookies, tokens, or complete request objects into activity or diagnostic output. Correlation SHALL NOT establish identity, authorization, idempotency, or transaction outcome.

#### Scenario: Record task change

- **WHEN** a user creates, edits, moves, or deletes a task
- **THEN** the system SHALL record an audit/activity event
- **AND** SHALL NOT store passwords, tokens, cookies, or secrets in the event

#### Scenario: Preserve available correlation for existing task mutations

- **GIVEN** an authenticated and authorized user supplies a valid UUID through `X-Correlation-ID`
- **WHEN** an existing create, effective edit, or effective move operation commits
- **THEN** the system SHALL persist the accepted UUID as `correlationId` on its respective `CREATED`, `UPDATED`, or `MOVED` event in the same atomic operation as the task mutation
- **AND** the event SHALL retain the authenticated actor, task and project identifiers, action, and operation timestamp
- **AND** an authorized activity query SHALL return that same correlation identifier

#### Scenario: Share correlation across column reallocation events

- **GIVEN** an authorized column deletion with a valid destination and accepted correlation identifier
- **WHEN** the operation commits the reallocation of several tasks
- **THEN** each affected task SHALL receive its existing `COLUMN_DELETED_REALLOCATION` event with the same correlation identifier
- **AND** events SHALL keep distinct event identifiers and their respective task identifiers, actor, project and timestamp
- **AND** reallocation SHALL NOT be represented as task deletion

#### Scenario: Operate without usable correlation

- **GIVEN** the optional header is absent, empty, not a single valid UUID, or not exactly 36 characters
- **WHEN** an existing Kanban mutation is otherwise valid and authorized
- **THEN** the system SHALL execute it with the existing behavior and omit `correlationId` from its event and activity response
- **AND** SHALL NOT generate a correlation identifier or retain the rejected value in activity, errors or logs
- **AND** direct atomic-port callers SHALL NOT be able to persist an invalid correlation value

#### Scenario: Preserve historic activity without correlation

- **GIVEN** activity rows persisted before the optional correlation column was introduced
- **WHEN** the additive migration is applied and an authorized user queries the history
- **THEN** the existing event identities, actor, action, resource identifiers, timestamps and details SHALL remain unchanged
- **AND** those responses SHALL omit `correlationId` without a backfill or fabricated value
- **AND** the runtime SHALL retain no UPDATE or DELETE privilege over activity

#### Scenario: Preserve existing authorization and metadata boundaries

- **GIVEN** a caller supplies a correlation identifier matching an event in another project or uses a different account
- **WHEN** that caller attempts a mutation or an activity query
- **THEN** the existing authentication and project permissions SHALL still determine access
- **AND** the system SHALL NOT derive the actor or expand the resource scope from correlation or client-supplied identity fields
- **AND** request bodies SHALL retain their existing validation rather than accept new actor or correlation fields

#### Scenario: No-op and rejected operations do not create correlated activity

- **GIVEN** an accepted correlation identifier accompanies an unchanged edit, unchanged effective position, or a rejected operation
- **WHEN** the operation is processed
- **THEN** the system SHALL preserve the existing no-op or error behavior without appending an activity event
- **AND** SHALL NOT append an event solely to store correlation

#### Scenario: Roll back state and correlated activity together

- **GIVEN** an existing Kanban mutation with accepted correlation and a failure before its transaction commits
- **WHEN** rollback is confirmed
- **THEN** neither the task mutation nor its new activity event SHALL be retained
- **AND** previously committed activity SHALL remain unchanged
- **AND** correlation alone SHALL NOT be treated as proof of commit or permission to retry a write

#### Scenario: Repeated correlation does not deduplicate real changes

- **GIVEN** two separate authorized effective mutations carry the same valid correlation identifier
- **WHEN** both operations successfully commit
- **THEN** the system SHALL retain each operation's distinct activity event with that correlation identifier
- **AND** SHALL NOT suppress a change or alter permissions because the correlation identifier was reused
