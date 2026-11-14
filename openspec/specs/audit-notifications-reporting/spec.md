# Audit, Notifications, and Reporting

## Purpose
Provide traceability and project progress visibility.

## Requirements

### Requirement: Audit relevant changes
The system SHALL record relevant changes with actor, action, resource identifier, timestamp, and correlation identifier when available.

#### Scenario: Record task change
- **WHEN** a user creates, edits, moves, or deletes a task
- **THEN** the system SHALL record an audit/activity event
- **AND** SHALL NOT store passwords, tokens, cookies, or secrets in the event

### Requirement: Internal notifications
The system SHALL generate internal notifications for configured relevant events such as upcoming deadlines and teacher observations. For a committed teacher review response with status `APPROVED` or `CHANGES_REQUESTED`, the system SHALL attempt to persist one internal notification for the original student requester only while that requester retains active project membership and permission to query the review. The notification SHALL reference the immutable committed teacher response action and SHALL be deduplicated by that action and recipient. This increment SHALL NOT imply preference-based delivery, an inbox API, external delivery, automatic retries, or guaranteed delivery across the post-commit gap.

#### Scenario: Notify about review
- **GIVEN** a review requested by student S in project P and S retains active membership and query permission
- **WHEN** the currently assigned teacher successfully commits an `APPROVED` or `CHANGES_REQUESTED` response
- **THEN** the system SHALL invoke `ReviewNotificationPort` after persistence using the identity of that committed response action
- **AND** when notification storage succeeds, the system SHALL persist one internal notification for S referencing P, the review, the response action and its status
- **AND** SHALL NOT create notifications for other project members or claim effective delivery according to preferences

#### Scenario: Repeated correction cycles remain distinct
- **GIVEN** two different committed `CHANGES_REQUESTED` actions separated by an authorized student resubmission
- **WHEN** both events are stored successfully for the authorized original requester
- **THEN** the system SHALL retain two notifications with different source action identities
- **AND** an eventual committed approval SHALL create a third notification when its storage succeeds
- **AND** requesting or resubmitting a review SHALL NOT itself create a teacher-response notification

#### Scenario: Deduplicate the same teacher response
- **GIVEN** the same valid committed response action and authorized recipient
- **WHEN** the event is processed repeatedly or concurrently
- **THEN** the system SHALL persist at most one notification for that action and recipient
- **AND** SHALL preserve the existing notification identity and creation timestamp
- **AND** SHALL NOT suppress a different response merely because its review or status is the same

#### Scenario: Reject recipients outside the authorized scope
- **GIVEN** an event names another member, an unrelated user, an inactive requester, or a review from another project
- **WHEN** notification storage validates the source action and recipient
- **THEN** the system SHALL NOT persist a notification for the unauthorized recipient
- **AND** SHALL NOT trust recipient identifiers supplied in the event without checking the persisted review context

#### Scenario: Validate the immutable source event
- **GIVEN** a nonexistent or uncommitted action, a non-response action, or an event whose project, review, teacher or status differs from the committed action
- **WHEN** notification storage validates the event
- **THEN** the system SHALL reject that event without inserting a notification
- **AND** SHALL use the immutable source action rather than the latest review status to identify a valid historical response

#### Scenario: Membership changes during storage
- **GIVEN** the requester's membership withdrawal races with notification storage
- **WHEN** the withdrawal commits before the storage transaction validates and protects the active membership
- **THEN** the system SHALL NOT insert a notification for that requester
- **AND** when storage commits before a subsequent withdrawal, the system SHALL NOT claim that the later withdrawal erased the earlier record or grants future read access

#### Scenario: Unauthorized review operations do not create notifications
- **GIVEN** a request without a session, an incorrect session role, an unassigned teacher, another student's review, a foreign project, or an invalid state transition
- **WHEN** the existing review operation rejects it with its contracted 401, 403, 404 or 409 response
- **THEN** the system SHALL NOT create a teacher response notification
- **AND** requesting or resubmitting with a session role other than `student` SHALL remain forbidden with HTTP 403 even if that user has active membership

#### Scenario: Review persistence failure prevents notification storage
- **GIVEN** a valid teacher response whose review transaction fails without a confirmed commit
- **WHEN** the review operation fails
- **THEN** the system SHALL NOT invoke notification storage
- **AND** SHALL NOT report a successful review response or invent a committed action identity

#### Scenario: Confirmed notification failure preserves the teacher response
- **GIVEN** the review and response action committed successfully
- **WHEN** notification authorization cannot be confirmed or insertion fails with a confirmed rollback
- **THEN** the system SHALL leave the review and immutable action unchanged and return the successful HTTP 200 review representation
- **AND** SHALL leave no partially inserted notification after a confirmed rollback
- **AND** SHALL record a safe structured diagnostic without observations, adjustments, evidence links, credentials or request bodies
- **AND** SHALL NOT retry the teacher response or automatically retry notification storage

#### Scenario: Unknown notification commit outcome
- **GIVEN** the review committed but confirmation of the notification commit is lost
- **WHEN** the system handles the storage outcome
- **THEN** the system SHALL classify the notification result as uncertain rather than claiming rollback or guaranteed delivery
- **AND** SHALL stop further effects for that attempt without automatic write retries and preserve safe correlation diagnostics for authorized reconciliation
- **AND** a connection close failure after a confirmed commit SHALL NOT be treated as a rollback
- **AND** the confirmed review SHALL remain successful

#### Scenario: Stored notifications survive process restart
- **GIVEN** internal notifications were confirmed persisted for two correction responses and final approval
- **WHEN** both API and PostgreSQL are stopped and restarted and the persisted records are inspected through the authorized test adapter
- **THEN** their complete identities, recipients, project, review, source actions, statuses and creation timestamps SHALL match the pre-restart records
- **AND** the review SHALL retain its `APPROVED` state and complete ordered six-event history

### Requirement: Permission-aware reporting
Reports SHALL aggregate only data the requesting user is authorized to access.

#### Scenario: Request unauthorized report
- **WHEN** a user requests a report for a course or project outside their scope
- **THEN** the system SHALL deny the request or return only the authorized subset

### Requirement: Student review notification inbox
The system SHALL provide a read-only inbox of persisted teacher review notifications for an authenticated session with role `student`. Each page SHALL derive the recipient from the session and SHALL restrict rows to that original review requester with current active project membership before applying cursor ordering and pagination. The system SHALL reuse the records introduced by migration 0007 without modifying their persistence, deduplication, or best-effort semantics.

#### Scenario: List minimal historical notifications
- **GIVEN** student S has stored notifications for committed teacher responses and active membership in their projects
- **WHEN** S calls `GET /api/review-notifications`
- **THEN** the system SHALL return HTTP 200 with `items` and `nextCursor`
- **AND** each item SHALL contain only `id`, `projectId`, `reviewId`, `responseActionId`, `status` and `createdAt`
- **AND** status SHALL represent the immutable source response, not the latest review state or current teacher assignment
- **AND** observations, adjustments, evidence links, recipient identity and unrelated members SHALL NOT be returned

#### Scenario: Require the student session rather than client identity
- **GIVEN** a caller requests the inbox
- **WHEN** the caller has no valid session
- **THEN** the system SHALL reject the request with HTTP 401
- **AND** a valid teacher or administrator session SHALL receive HTTP 403 even with active membership or a matching historical recipient identifier
- **AND** the recipient SHALL come from the authenticated session, not query parameters or forged identity headers in authenticated mode

#### Scenario: Filter authorized rows before pagination
- **GIVEN** stored rows include other recipients, inactive projects, and eligible notifications for student S
- **WHEN** S requests a page of size L
- **THEN** the system SHALL filter by S, original requestership and active membership before applying the position, order and limit
- **AND** excluded rows SHALL NOT consume page slots or determine nextCursor
- **AND** project creation, another member's request or teacher assignment SHALL NOT substitute for S's active membership and original requestership
- **AND** no totals or pagination metadata SHALL reveal excluded rows

#### Scenario: Revalidate access after membership withdrawal
- **GIVEN** S received a cursor while a project membership was active
- **WHEN** withdrawal commits before the next page's database statement snapshot
- **THEN** that page SHALL exclude all notifications of that project even if the cursor refers to one of them
- **AND** other eligible projects MAY fill the page; no eligible records SHALL produce HTTP 200 with an empty list and null nextCursor
- **AND** the stored notifications SHALL remain unchanged rather than being deleted

#### Scenario: Define the boundary of concurrent revocation
- **GIVEN** inbox reading races with membership withdrawal
- **WHEN** the withdrawal commits before the read statement snapshot
- **THEN** the project rows SHALL be excluded
- **AND** a withdrawal committed after that snapshot SHALL NOT be claimed to erase an earlier authorized response; subsequent requests SHALL revalidate
- **AND** pages SHALL NOT claim a shared snapshot or retroactive removal of data already delivered

#### Scenario: Regained membership permits historical records again
- **GIVEN** stored notifications were hidden because S no longer had active membership
- **WHEN** S again has active membership and requests a fresh page
- **THEN** those historical records SHALL again be eligible under the current scope and cursor position
- **AND** the system SHALL NOT recreate or modify their identities or timestamps

#### Scenario: Apply deterministic ordering and authorized lookahead
- **GIVEN** S has multiple eligible notifications, including equal creation timestamps
- **WHEN** a page is read
- **THEN** items SHALL be ordered by `created_at DESC, id DESC`
- **AND** the page SHALL contain at most limit items, default 20 and maximum 100
- **AND** nextCursor SHALL identify the last returned item only when an additional authorized row was observed beyond the limit
- **AND** otherwise nextCursor SHALL be null

#### Scenario: Preserve microseconds across cursor boundaries
- **GIVEN** eligible rows have different creation timestamps within the same millisecond and UUID ordering opposite to their timestamp ordering
- **WHEN** S traverses successive pages
- **THEN** ordering and the strict older-than boundary SHALL preserve all timestamp microseconds without skipping or duplicating those rows
- **AND** the v1 cursor SHALL preserve a canonical UTC timestamp with six fractional digits and UUID without conversion through Date or epoch milliseconds
- **AND** a formatted date displayed by the client SHALL NOT be used to rebuild the cursor

#### Scenario: Treat a cursor as a bounded position, not authorization
- **GIVEN** S supplies a cursor
- **WHEN** its encoding, length over 256 characters, JSON keys, version, real calendar timestamp with six UTC fractional digits, or UUID is invalid
- **THEN** the system SHALL return HTTP 400 without querying the notification store
- **AND** a valid cursor referencing an absent, foreign or newly unauthorized row SHALL NOT require lookup or grant access to that row
- **AND** such a position SHALL continue to apply only to S's currently eligible records
- **AND** unknown query keys or limit outside the integer range 1 to 100 SHALL also return HTTP 400

#### Scenario: Refresh a live list without promising a global snapshot
- **GIVEN** new notifications or membership changes occur between pages
- **WHEN** S requests another page
- **THEN** the system SHALL apply the current authorization scope and strict cursor boundary
- **AND** rows newer than that position SHALL be discoverable by refreshing from the beginning rather than by promising an immutable multi-page snapshot

#### Scenario: Fail closed without stale or partial data
- **GIVEN** the system cannot confirm current access or complete the inbox query
- **WHEN** the request is handled
- **THEN** it SHALL return a sanitized HTTP 500 rather than partial items or a false successful empty result
- **AND** responses SHALL use Cache-Control no-store and SHALL NOT rely on stale authorization or shared response caching
- **AND** error diagnostics SHALL NOT expose SQL details, session credentials or notification contents

#### Scenario: Keep the business flow read-only and best-effort
- **GIVEN** existing notifications, reviews and memberships, including a committed response whose notification failed to persist
- **WHEN** the inbox is queried
- **THEN** the query SHALL NOT insert, update or delete notifications, reviews or memberships, or invoke notification emission
- **AND** it SHALL NOT synthesize or repair a missing notification from the review history
- **AND** distinct persisted teacher responses with the same status SHALL remain distinct items
- **AND** the existing teacher-response HTTP contract and best-effort failure behavior SHALL remain unchanged

#### Scenario: Present one authorized page in the student application
- **GIVEN** S opens the inbox in the application
- **WHEN** a page is loaded or replaced
- **THEN** the application SHALL present the historical approval/change-request message, date and project/review references with loading, empty and error states
- **AND** it SHALL provide keyboard-accessible refresh, next-page when available and retry actions without adding write controls or unavailable detail-page links
- **AND** starting a new page request SHALL discard the previous visible page rather than accumulating potentially revoked records

#### Scenario: Discard stale client state across session and focus changes
- **GIVEN** the application holds inbox results or a pending request
- **WHEN** the user leaves the inbox, logs out, changes identity/role, or receives 401, 403 or an inbox load error
- **THEN** visible items SHALL be cleared and ineligible pending responses SHALL NOT repopulate a different identity or abandoned view
- **AND** session changes SHALL reset cursors
- **AND** refresh or regaining focus on the inbox SHALL discard the previous page and revalidate from the first page
- **AND** the application SHALL NOT persist inbox pages in localStorage or promise real-time revocation of previously delivered data
