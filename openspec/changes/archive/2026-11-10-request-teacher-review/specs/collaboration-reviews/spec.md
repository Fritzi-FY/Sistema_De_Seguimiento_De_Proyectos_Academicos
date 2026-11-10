# Delta Spec: Collaboration and Reviews - Teacher Review Workflow

## MODIFIED Requirements

### Requirement: Teacher review
The system SHALL allow an authorized student with active project membership to submit a project-level teacher review request (with title, progress description, and optional evidence link), SHALL allow the currently assigned teacher to respond with an evaluation status and observations, SHALL preserve the same review entity across correction cycles by recording every re-submission and response as immutable action entries with a strictly monotonic per-review sequence number assigned within the same transactional boundary (guaranteeing exact transition order even when timestamps coincide), and SHALL limit query access to the requesting student with active membership and the currently assigned teacher, deriving the chronological history deterministically from persisted records.

#### Scenario: Review deliverable
- **WHEN** the assigned teacher submits a review
- **THEN** the system SHALL persist the review and notify relevant project members according to notification settings

#### Scenario: Active student member requests a project-level teacher review
- **GIVEN** an authenticated user who holds an active membership (`owner` or `collaborator`) in project `P`
- **AND** a valid review request payload containing `title`, `description` (detailing progress achieved), and optional `evidenceUrl` (metadata link per ADR-006)
- **WHEN** the student submits an HTTP `POST` to `/api/projects/:projectId/reviews`
- **THEN** the system SHALL resolve identity from the authenticated session context
- **AND** SHALL validate that the user has an active membership (`status: "active"`) in project `P`
- **AND** SHALL persist a new review request record with a unique UUID v4 identifier, initial status `"PENDING"`, and current timestamp
- **AND** SHALL respond with HTTP status 201 Created and the review request JSON representation
- **AND** the formal registration of deliverables (FR-011) SHALL remain deferred outside this increment

#### Scenario: Non-student session cannot request or resubmit a review
- **GIVEN** an authenticated user whose trusted session role is not `student`
- **AND** the user may hold active project membership or be the original requester
- **WHEN** the user submits `POST /api/projects/:projectId/reviews` or `POST /api/projects/:projectId/reviews/:reviewId/re-submit`
- **THEN** the corresponding use case SHALL reject the operation with HTTP status 403 Forbidden before accessing persistence
- **AND** SHALL NOT create a request, change review state, or append an action
- **AND** clients SHALL NOT override the session role through payloads or development identity headers

#### Scenario: Currently assigned teacher responds to a review request
- **GIVEN** an authenticated user with role `"teacher"` who is currently assigned to project `P` in `teacher_project_assignments`
- **AND** an existing review request `R` in project `P` with status `"PENDING"`
- **AND** a valid response payload containing `status` (`"APPROVED"` or `"CHANGES_REQUESTED"`) and `observation` text (5 to 2000 characters)
- **WHEN** the teacher submits an HTTP `POST` to `/api/projects/:projectId/reviews/:reviewId/response`
- **THEN** the system SHALL verify current teacher assignment to project `P` via `TeacherProjectScopePort`
- **AND** SHALL execute an atomic database transaction that:
  - Updates the review request status to the evaluated status (`"APPROVED"` or `"CHANGES_REQUESTED"`)
  - Assigns the next monotonic sequence number for review `R`
  - Inserts an immutable action record with `actionType: "TEACHER_RESPONSE"`, `sequenceNumber`, `actorId` (teacher), `actorRole: "teacher"`, `status`, `comment` (observation), and current timestamp
- **AND** SHALL emit a verifiable notification event via `ReviewNotificationPort` containing review details, teacher identity, and the requesting student ID only if they retain active membership and query permission
- **AND** SHALL respond with HTTP status 200 OK and the updated review representation

#### Scenario: Re-evaluation request after CHANGES_REQUESTED
- **GIVEN** an existing review request `R` in project `P` with current status `"CHANGES_REQUESTED"`
- **AND** the requesting student retains active membership in project `P`
- **WHEN** the student submits `POST /api/projects/:projectId/reviews/:reviewId/re-submit` with `description` (detailing adjustments made, 10 to 2000 characters) and optional `evidenceUrl`
- **THEN** the system SHALL execute an atomic database transaction that:
  - Updates the review request status from `"CHANGES_REQUESTED"` to `"PENDING"`
  - Assigns the next monotonic sequence number for review `R`
  - Inserts an immutable action record with `actionType: "STUDENT_RESUBMISSION"`, `sequenceNumber`, `actorId` (student), `actorRole: "student"`, `status: "PENDING"`, `comment` (adjustments description), optional `evidenceUrl`, and current timestamp
- **AND** SHALL preserve the original review request entity identifier and prior teacher evaluation actions
- **AND** SHALL respond with HTTP status 200 OK and the updated review representation

#### Scenario: Multi-cycle correction workflow and real restart survivability
- **GIVEN** a review request `R` in project `P` that completes two full correction cycles:
  1. Student `S` creates initial request (`status: "PENDING"`, sequence 0)
  2. Teacher `T` responds with `"CHANGES_REQUESTED"` and observation `Obs 1` (sequence 1)
  3. Student `S` re-submits with adjustment description `Adj 1` (`status: "PENDING"`, sequence 2)
  4. Teacher `T` responds again with `"CHANGES_REQUESTED"` and observation `Obs 2` (sequence 3)
  5. Student `S` re-submits with adjustment description `Adj 2` (`status: "PENDING"`, sequence 4)
  6. Teacher `T` responds with `"APPROVED"` and final feedback `Obs 3` (sequence 5)
- **WHEN** the test environment performs a real restart of the API server process and PostgreSQL database
- **AND** authorized student `S` or assigned teacher `T` submits `GET /api/projects/:projectId/reviews/:reviewId`
- **THEN** the system SHALL respond with HTTP status 200 OK
- **AND** the response SHALL contain current status `"APPROVED"`
- **AND** the response SHALL contain the complete chronological history of all 6 events ordered strictly by `sequenceNumber ASC`, guaranteeing exact transition ordering even if database timestamps coincide, verifying exact preservation of actors (`S` and `T`), dates, comments, links, and action types without loss or duplication of facts

#### Scenario: Race condition control on concurrent re-solicitudes
- **GIVEN** an existing review request `R` in project `P` with current status `"CHANGES_REQUESTED"`
- **WHEN** two re-submission requests for review `R` arrive simultaneously from the client
- **THEN** the system SHALL serialize the status transition within the database transaction (using row-level locking `FOR UPDATE` on `teacher_review_requests`)
- **AND** the first transaction SHALL succeed, transition the status to `"PENDING"`, assign sequence number `N`, and append the action record
- **AND** the concurrent second transaction SHALL detect that status is no longer `"CHANGES_REQUESTED"`, SHALL reject the transition with HTTP status 409 Conflict, and SHALL NOT create a duplicate action record or sequence gap

#### Scenario: Atomicity and rollback on action registration failure
- **GIVEN** an assigned teacher submitting a valid review response or a student submitting a re-submission
- **AND** an infrastructure failure occurs while inserting the action record into `teacher_review_actions`
- **WHEN** the transaction encounters the error
- **THEN** the system SHALL roll back the entire transaction completely
- **AND** the review request status in `teacher_review_requests` SHALL remain strictly unchanged in its prior state
- **AND** NO orphan or partial records SHALL be persisted in `teacher_review_actions`
- **AND** the system SHALL respond with HTTP status 500 Internal Server Error without disclosing internal traces

#### Scenario: Consultation restricted to requesting student with active membership and assigned teacher
- **GIVEN** an existing review request `R` in project `P` requested by student `S`
- **WHEN** student `S` (retaining active membership in `P`) or the currently assigned teacher of `P` submits `GET /api/projects/:projectId/reviews/:reviewId`
- **THEN** the system SHALL respond with HTTP status 200 OK
- **AND** the response SHALL contain the review request, current status, and the complete chronological history derived deterministically from `teacher_review_requests` and `teacher_review_actions` ordered by sequence number

#### Scenario: Other project members cannot query individual review
- **GIVEN** an authenticated collaborator `C` of project `P` who is NOT the original requester of review `R`
- **WHEN** collaborator `C` submits `GET /api/projects/:projectId/reviews/:reviewId`
- **THEN** the system SHALL reject the request with HTTP status 404 Not Found
- **AND** SHALL NOT disclose the review request, observations, or history

#### Scenario: Reassignment — newly assigned teacher attends open requests and queries history
- **GIVEN** a review request `R` created while teacher `T1` was assigned to project `P`
- **AND** teacher `T1` is unassigned and teacher `T2` is newly assigned to project `P` in `teacher_project_assignments`
- **WHEN** teacher `T2` submits `GET /api/projects/:projectId/reviews/:reviewId` or `POST /api/projects/:projectId/reviews/:reviewId/response`
- **THEN** the system SHALL authorize teacher `T2` based on current assignment
- **AND** SHALL allow `T2` to inspect the full chronological history preserving original authors (`requesterId: S`, and `actorId: T1` on prior responses)
- **AND** SHALL allow `T2` to respond to open `"PENDING"` review requests

#### Scenario: Loss of access — outgoing unassigned teacher
- **GIVEN** a teacher `T_old` who was previously assigned to project `P` and has been removed from `teacher_project_assignments`
- **WHEN** teacher `T_old` submits `GET /api/projects/:projectId/reviews/:reviewId` or `POST /api/projects/:projectId/reviews/:reviewId/response`
- **THEN** the system SHALL reject the request with HTTP status 404 Not Found
- **AND** SHALL NOT disclose review existence, metadata, or allow any modification

#### Scenario: Loss of access — student with removed membership
- **GIVEN** student `S` who created review request `R` in project `P`
- **AND** student `S` subsequently has their membership set to `status: "removed"` in `project_memberships`
- **WHEN** student `S` submits `GET /api/projects/:projectId/reviews/:reviewId` or submits a re-submission request
- **THEN** the system SHALL reject the request with HTTP status 404 Not Found
- **AND** SHALL NOT disclose review existence, metadata, or permit any re-evaluation

#### Scenario: Rejection — student attempts to submit teacher review response
- **GIVEN** an authenticated user with role `"student"` (even the project owner or requester)
- **WHEN** the student submits `POST /api/projects/:projectId/reviews/:reviewId/response`
- **THEN** the system SHALL verify the role from the trusted identity context
- **AND** SHALL reject the request with HTTP status 403 Forbidden
- **AND** SHALL NOT permit evaluation submission by non-teacher roles

#### Scenario: Rejection — unauthenticated access
- **GIVEN** a request with no authenticated session
- **WHEN** the client requests any review endpoint under `/api/projects/:projectId/reviews`
- **THEN** the system SHALL reject the request with HTTP status 401 Unauthorized

#### Scenario: Isolation — cross-project ID tampering
- **GIVEN** an authenticated user authorized on project `P1`
- **AND** a review request `R2` belonging to a different project `P2`
- **WHEN** the client submits any request targeting `/api/projects/P1/reviews/R2` or `/api/projects/P2/reviews/R2`
- **THEN** the system SHALL respond with HTTP status 404 Not Found
- **AND** SHALL NOT disclose data or permit mutations across project boundaries

#### Scenario: Verifiable notification event emission (EPIC-006) vs effective delivery according to preferences (EPIC-007)
- **GIVEN** an assigned teacher submitting a review response
- **WHEN** the response transaction commits successfully
- **THEN** the system SHALL verify that the domain port `ReviewNotificationPort` was invoked with review ID, status (`"APPROVED"` or `"CHANGES_REQUESTED"`), reviewer ID, and authorized recipients (verifiable via test spy in automated tests)
- **AND** effective notification delivery according to individual recipient notification settings SHALL be formally recognized as dependent on EPIC-007 implementation

#### Scenario: Post-persistence notification failure handling — diagnostic logging without sensitive data and successful response
- **GIVEN** an assigned teacher submitting a valid review response
- **AND** the database transaction commits the review status update and action record successfully
- **AND** a failure occurs while querying recipient membership or invoking `ReviewNotificationPort`
- **WHEN** the use case captures the post-persistence failure
- **THEN** the system SHALL record a structured diagnostic event via existing diagnostic facilities without disclosing observations, adjustments, evidence links, or sensitive data
- **AND** SHALL NOT dispatch notification if recipient permissions cannot be confirmed
- **AND** SHALL respond with HTTP status 200 OK and the updated review representation
- **AND** the review status and action record SHALL remain safely persisted exactly once
- **AND** the system SHALL NOT guarantee retries or delivery persistence in this block (deferred to EPIC-007)

#### Scenario: Persistence failure prevents notification emission
- **GIVEN** an assigned teacher submitting a review response
- **AND** an infrastructure failure occurs during database persistence
- **WHEN** the persistence operation throws an exception
- **THEN** the system SHALL propagate the persistence error to the caller (HTTP 500)
- **AND** SHALL NOT invoke `ReviewNotificationPort`

#### Scenario: Notification restricted to requester with active membership and query permission
- **GIVEN** an existing review request `R` submitted by student `S` in project `P`
- **AND** the assigned teacher submits a response to review `R`
- **WHEN** the system resolves notification recipients
- **THEN** student `S` SHALL be included in `recipientUserIds` ONLY IF student `S` retains active membership (`status: "active"`) in project `P`
- **AND** student `S` SHALL NOT be notified if their membership has been set to `"removed"` or is inactive
