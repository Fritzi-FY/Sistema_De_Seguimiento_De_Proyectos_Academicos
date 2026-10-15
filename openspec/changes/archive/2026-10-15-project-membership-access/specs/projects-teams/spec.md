## MODIFIED Requirements

### Requirement: Project creation
The system SHALL allow an authorized user to create an academic project with a validated title,
description, course code, start date, target completion date, and creator membership.

#### Scenario: Successful project creation with atomic owner membership
- **GIVEN** an authorized user context (e.g., student `dev-student-01`)
- **AND** a valid project creation payload containing title, description, courseCode,
  startDate, and targetDate
- **WHEN** the client submits an HTTP `POST` request to `/api/projects`
- **THEN** the system SHALL validate all input fields against the project schema
- **AND** the system SHALL assign a unique UUID v4 identifier
- **AND** the system SHALL set the initial status to `"active"`
- **AND** the system SHALL assign the requesting user as the project creator (`creatorId`)
- **AND** the system SHALL persist consistently, as an all-or-nothing operation, the
  project record and a `ProjectMembership` record with `role: "owner"` and `status: "active"`
  for the creating user, via the `ProjectCreationPort`: either both records are persisted
  or neither is (no project SHALL exist without its owner membership after a recoverable failure)
- **AND** the system SHALL respond with HTTP status 201 Created and the created project
  JSON representation

#### Scenario: Consistency invariant — project always has an owner membership
- **GIVEN** any project that has been successfully created
- **WHEN** the system retrieves its membership list
- **THEN** there SHALL exist exactly one active membership record with `role: "owner"`
- **AND** the `userId` of that owner membership SHALL equal the project's `creatorId`

#### Scenario: Consistency invariant — no leftover state on creation failure
- **GIVEN** an authorized user submitting a valid `POST /api/projects` request
- **AND** the persistence of the owner membership fails after the project has been
  constructed (e.g., instrumented adapter throws on second mutation)
- **WHEN** the `ProjectCreationPort` implementation handles the failure
- **THEN** the system SHALL NOT persist the project record
- **AND** the system SHALL NOT persist any membership record
- **AND** the system SHALL propagate the error to the HTTP adapter, which SHALL respond
  with HTTP status 500 Internal Server Error
- **AND** a subsequent `GET /api/projects/:id` for the attempted project id SHALL return
  HTTP status 404 Not Found

---

### Requirement: Project membership
The system SHALL maintain explicit membership and project-level roles, isolating project
visibility and query operations to authorized users.

#### Scenario: Add a collaborator — success
- **GIVEN** an authenticated user who is the creator (owner) of project `P`
- **AND** the target user `U` is not already an active member of project `P`
- **WHEN** the owner submits an HTTP `POST` to `/api/projects/:id/members`
  with body `{ "userId": "<U-uuid>", "role": "collaborator" }`
- **THEN** the system SHALL create one membership record with `role: "collaborator"`
  and `status: "active"`
- **AND** SHALL respond with HTTP status 201 Created and the membership JSON representation

#### Scenario: Add a collaborator — rejected: duplicate active membership
- **GIVEN** user `U` already has an `active` membership in project `P`
- **WHEN** the owner submits `POST /api/projects/:id/members` with `userId` equal to `U`
- **THEN** the system SHALL respond with HTTP status 409 Conflict
- **AND** SHALL NOT create a duplicate membership record
- **AND** the response body SHALL indicate the conflict without disclosing other membership data

#### Scenario: Add a collaborator — rejected: requester is not the creator
- **GIVEN** an authenticated user who is NOT the creator of project `P`
  (even if they are a collaborator)
- **WHEN** they submit `POST /api/projects/:id/members`
- **THEN** the system SHALL respond with HTTP status 403 Forbidden
- **AND** SHALL NOT create any membership record

#### Scenario: Add a collaborator — rejected: project not found
- **GIVEN** an authenticated user submitting `POST /api/projects/:id/members`
  where `:id` does not match any existing project
- **THEN** the system SHALL respond with HTTP status 404 Not Found
- **AND** SHALL NOT disclose whether any project exists at that identifier

#### Scenario: Remove a collaborator — success
- **GIVEN** the requesting user is the creator of project `P`
- **AND** target user `U` has an active `collaborator` membership in project `P`
- **WHEN** the creator submits `DELETE /api/projects/:id/members/:userId`
- **THEN** the system SHALL set the membership `status` to `"removed"`
- **AND** SHALL respond with HTTP status 200 OK with a JSON body containing the updated
  membership record, including all fields (`id`, `projectId`, `userId`, `role`, `status: "removed"`,
  `joinedAt`, `updatedAt`)

#### Scenario: Remove a collaborator — rejected: cannot remove the owner
- **GIVEN** the target `userId` equals the project's `creatorId`
- **WHEN** a removal request is submitted for that user
- **THEN** the system SHALL respond with HTTP status 422 Unprocessable Entity
- **AND** SHALL NOT modify the owner's membership record
- **AND** the response body SHALL explain that the owner cannot be removed

#### Scenario: Remove a collaborator — rejected: requester is not the creator
- **GIVEN** an authenticated user who is NOT the creator of project `P`
- **WHEN** they submit `DELETE /api/projects/:id/members/:userId`
- **THEN** the system SHALL respond with HTTP status 403 Forbidden

#### Scenario: Remove a collaborator — rejected: target membership not found
- **GIVEN** the creator of project `P` submits a removal request for user `U`
- **AND** user `U` has no active membership in project `P`
- **THEN** the system SHALL respond with HTTP status 404 Not Found

#### Scenario: Scope isolation for student project listing — updated
- **GIVEN** an authenticated student context (`user-student-A`)
- **AND** the following project state in the repository:
  - Project `P1` created by `user-student-A` (has automatic owner membership)
  - Project `P2` created by `user-student-B`, with `user-student-A` added as a
    `collaborator` (active membership)
  - Project `P3` created by `user-student-C`, with no membership for `user-student-A`
- **WHEN** `user-student-A` submits an HTTP `GET` request to `/api/projects`
- **THEN** the system SHALL respond with HTTP status 200 OK
- **AND** the response payload SHALL contain `P1` and `P2`
- **AND** SHALL NOT include `P3` or disclose its identifier or metadata
- **AND** no project SHALL appear more than once in the response list

#### Scenario: Project detail access — authorized collaborator
- **GIVEN** an authenticated user `U` who is an active `collaborator` of project `P`
- **WHEN** `U` submits `GET /api/projects/:id`
- **THEN** the system SHALL respond with HTTP status 200 OK and the project JSON representation

#### Scenario: Unauthorized project detail inquiry — updated
- **GIVEN** an authenticated user with no active membership in project `P`
- **WHEN** they submit `GET /api/projects/:id`
- **THEN** the system SHALL respond with HTTP status 404 Not Found
- **AND** SHALL NOT disclose the project title, description, metadata, or membership list

---

## ADDED Requirements

### Requirement: Membership management endpoints
The system SHALL expose HTTP endpoints to add, remove, and list project members,
restricted to authenticated users with the appropriate membership role.

#### Scenario: List project members — authorized member
- **GIVEN** an authenticated user who is an active member (owner or collaborator)
  of project `P`
- **WHEN** they submit `GET /api/projects/:id/members`
- **THEN** the system SHALL respond with HTTP status 200 OK
- **AND** the response SHALL contain the list of active membership records,
  each including `userId`, `role`, `joinedAt`, and `status`
- **AND** SHALL NOT include memberships with `status: "removed"`

#### Scenario: List project members — unauthorized (no membership)
- **GIVEN** an authenticated user with no active membership in project `P`
- **WHEN** they submit `GET /api/projects/:id/members`
- **THEN** the system SHALL respond with HTTP status 404 Not Found
- **AND** SHALL NOT disclose the member list or any project metadata

#### Scenario: Unauthenticated access to any membership endpoint
- **GIVEN** a client with no valid authenticated identity (no `X-Dev-User-Id` in
  development mode, or no valid session in production)
- **WHEN** they submit any request to `/api/projects/:id/members`
- **THEN** the system SHALL respond with HTTP status 401 Unauthorized
- **AND** SHALL NOT process the membership operation

### Requirement: Membership role definitions
The system SHALL enforce the following role semantics within a `ProjectMembership`:

- `owner`: assigned automatically to the project creator; exactly one active owner
  per project; cannot be removed via the membership management endpoints.
- `collaborator`: assigned to users added by the project creator; can be removed by
  the creator at any time.

The `role` field in the `AddMemberRequestSchema` SHALL only accept `"collaborator"`;
the `"owner"` role is assigned exclusively by internal system logic.

#### Scenario: Role field only accepts collaborator in the public API
- **GIVEN** an authenticated project owner submitting `POST /api/projects/:id/members`
- **WHEN** the request body contains `{ "userId": "<uuid>", "role": "owner" }`
- **THEN** the system SHALL respond with HTTP status 400 Bad Request
- **AND** SHALL NOT create any membership record with `role: "owner"` via the public endpoint
- **AND** the response body SHALL contain a field-level validation error for `role`

### Requirement: Membership data integrity
- A pair (`projectId`, `userId`) SHALL have at most one active membership record
  at any given time.
- A removed membership (`status: "removed"`) does not count toward the active
  membership constraint; a previously removed user may be re-added.
- The `owner` membership SHALL NOT be removable through any public endpoint.

#### Scenario: Previously removed member can be re-added
- **GIVEN** user `U` was once a `collaborator` of project `P` and was subsequently removed
  (membership `status: "removed"`)
- **WHEN** the project owner submits `POST /api/projects/:id/members`
  with `userId: U` and `role: "collaborator"`
- **THEN** the system SHALL create a new active membership record for `U`
- **AND** SHALL respond with HTTP status 201 Created
- **AND** the previously removed membership record SHALL remain in history with
  `status: "removed"` (no mutation of historical records)
