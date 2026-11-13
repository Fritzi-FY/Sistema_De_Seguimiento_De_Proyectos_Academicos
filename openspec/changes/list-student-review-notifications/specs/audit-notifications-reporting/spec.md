## ADDED Requirements

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
