## MODIFIED Requirements

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
