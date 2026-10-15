# Projects and Teams

## Purpose
Manage academic projects, courses, memberships, and responsible teachers.

## Requirements

### Requirement: Project creation
The system SHALL allow an authorized user to create an academic project with a validated title, description, course code, start date, target completion date, and creator membership.

#### Scenario: Successful project creation
- **GIVEN** an authorized user context (e.g., student `dev-student-01`)
- **AND** a valid project creation payload containing:
  - `title`: string between 3 and 120 characters
  - `description`: optional string up to 500 characters
  - `courseCode`: string between 2 and 20 characters (e.g., "IS-488")
  - `startDate`: valid ISO-8601 UTC date string
  - `targetDate`: valid ISO-8601 UTC date string chronologically equal to or after `startDate`
- **WHEN** the client submits an HTTP `POST` request to `/api/projects`
- **THEN** the system SHALL validate all input fields against the project schema
- **AND** the system SHALL assign a unique UUID v4 identifier
- **AND** the system SHALL set the initial status to `"active"`
- **AND** the system SHALL assign the requesting user as the project creator (`creatorId`)
- **AND** the system SHALL persist the project record via the repository port
- **AND** the system SHALL respond with HTTP status 201 Created and the created project JSON representation

#### Scenario: Project creation rejected due to invalid date chronology
- **GIVEN** an authorized user context
- **AND** a project creation payload where `targetDate` is chronologically prior to `startDate`
- **WHEN** the client submits an HTTP `POST` request to `/api/projects`
- **THEN** the system SHALL reject the request with HTTP status 400 Bad Request
- **AND** the response body SHALL detail the date chronology validation error without disclosing internal stack traces

#### Scenario: Project creation rejected due to missing or invalid fields
- **GIVEN** an authorized user context
- **AND** a payload with an empty title, title exceeding 120 characters, missing `courseCode`, or malformed date strings
- **WHEN** the client submits an HTTP `POST` request to `/api/projects`
- **THEN** the system SHALL reject the request with HTTP status 400 Bad Request
- **AND** the response body SHALL contain structured field-level error messages

### Requirement: Project membership
The system SHALL maintain explicit membership and project-level roles, isolating project visibility and query operations to authorized users.

#### Scenario: Add a member
- **WHEN** an authorized project member adds an eligible user
- **THEN** the system SHALL create one membership record
- **AND** SHALL prevent duplicate membership for the same project and user

#### Scenario: Scope isolation for student project listing
- **GIVEN** an authenticated student context (e.g., `user-student-A`)
- **AND** projects existing in the repository created by `user-student-A` and projects created by other unrelated students
- **WHEN** `user-student-A` submits an HTTP `GET` request to `/api/projects`
- **THEN** the system SHALL respond with HTTP status 200 OK
- **AND** the response payload SHALL contain ONLY projects where `user-student-A` is the creator or an explicit member
- **AND** SHALL NOT disclose projects or project identifiers belonging to other students

#### Scenario: Unauthorized project detail inquiry
- **GIVEN** an authenticated user context
- **WHEN** the user submits an HTTP `GET` request to `/api/projects/:id` for a project ID where the user has no membership or authorized teacher assignment
- **THEN** the system SHALL reject the inquiry with HTTP status 404 Not Found (or 403 Forbidden)
- **AND** SHALL NOT disclose project titles, metadata, or membership lists

### Requirement: Teacher scope
The system SHALL limit teacher review and reporting to projects assigned to that teacher or otherwise explicitly authorized.

#### Scenario: Teacher outside assignment
- **WHEN** a teacher accesses a project outside their assigned scope
- **THEN** the system SHALL deny access unless an explicit administrative permission applies

### Requirement: Controlled development identity context
The system SHALL allow simulated identity context headers (`X-Dev-User-Id` and `X-Dev-User-Role`) exclusively when the server executes in development mode (`NODE_ENV === 'development'`), and SHALL strictly reject such headers in production.

#### Scenario: Acceptance of simulated identity in development mode
- **GIVEN** the application server running with environment configuration `NODE_ENV === 'development'`
- **WHEN** a client submits a request with headers `X-Dev-User-Id: student-01` and `X-Dev-User-Role: student`
- **THEN** the system SHALL resolve the request context with user identity `student-01` and role `student`
- **AND** SHALL process the request accordingly

#### Scenario: Strict rejection of simulated identity in production mode
- **GIVEN** the application server running with environment configuration `NODE_ENV === 'production'`
- **WHEN** an external client submits a request including `X-Dev-User-Id` or `X-Dev-User-Role` headers
- **THEN** the system SHALL ignore or reject the unverified simulated headers
- **AND** SHALL respond with HTTP status 401 Unauthorized if no authentic session token is present
- **AND** SHALL NOT allow security bypass of institutional authentication

### Requirement: Volatile in-memory persistence notice
The baseline in-memory repository implementation SHALL be documented and verified as a volatile development adapter that clears its state upon server restart.

#### Scenario: Ephemeral storage behavior
- **GIVEN** the application running with the in-memory repository adapter
- **WHEN** projects are created and subsequently the server process terminates or restarts
- **THEN** the system state resets to empty
- **AND** the architectural design SHALL maintain strict separation so replacing the adapter with PostgreSQL/Drizzle requires zero changes to use cases or domain models
