## Purpose

Proveer tableros Kanban interactivos, configurables y accesibles, y gestión granular del ciclo de vida de tareas para proyectos académicos en IS488.

## MODIFIED Requirements

### Requirement: Project board
Each academic project SHALL have an associated Kanban board containing ordered columns with configurable names (1 to 50 characters), ordering index, semantic categories (`TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`), and visual properties. The board SHALL enforce a minimum of 1 column and a maximum limit of 10 columns per project. Board initialization SHALL be lazy and idempotent against concurrent requests, ensuring only a single board structure with canonical columns is established.

#### Scenario: Configure a column
- **GIVEN** an authenticated and authorized project member (student member, project owner, or assigned teacher)
- **WHEN** the member sends an HTTP request to create or update a column with valid name, category, and order
- **THEN** the system SHALL persist the column configuration and sequence index
- **AND** the system SHALL return HTTP status 201 Created for a new column or 200 OK for an update
- **AND** the response SHALL contain the column entity with its unique identifier

#### Scenario: Exceeding column limit
- **GIVEN** a project board that already contains 10 columns
- **WHEN** an authorized member attempts to create an additional column
- **THEN** the system SHALL reject the operation with HTTP status 400 Bad Request
- **AND** SHALL return an error message indicating that the maximum column limit (10) has been reached

#### Scenario: Idempotent concurrent board initialization
- **GIVEN** an authorized project member accessing a newly created project without an existing board
- **WHEN** multiple concurrent requests initiate board retrieval simultaneously
- **THEN** the system SHALL initialize the default board with 3 canonical columns idempotently
- **AND** SHALL return the identical board structure to all concurrent requests without duplicating columns or throwing race-condition errors

#### Scenario: Unauthorized column configuration
- **GIVEN** an authenticated user who is neither an active member of the project nor a teacher formally assigned to that project
- **WHEN** the user attempts to create, update, or reorder a column on that project's board
- **THEN** the system SHALL reject the request with HTTP status 404 Not Found
- **AND** SHALL NOT disclose project or board metadata

### Requirement: Task lifecycle
A task SHALL belong to exactly one project and one valid column within that project's board. The server SHALL be the sole authority for validating and executing task transitions and ordering. Moving a task SHALL be atomic within a single transactional boundary, SHALL sequentially adjust order indices within columns, and SHALL record an immutable task activity event with the actor, source column, destination column, and timestamp. If any step fails, the entire operation SHALL roll back.

#### Scenario: Move task
- **GIVEN** an authorized member and an existing task in column A of the project
- **WHEN** the member sends a move request specifying a valid destination column B within the same project board and a destination order index
- **THEN** the system SHALL update the task's column and order index atomically
- **AND** SHALL adjust sibling task order indices to preserve sequential contiguous ordering
- **AND** SHALL record an immutable activity event capturing the transition
- **AND** SHALL return HTTP status 200 OK with the updated task representation

#### Scenario: Invalid destination
- **GIVEN** an authorized member and an existing task in project X
- **WHEN** the member attempts to move the task to a column identifier that belongs to another project Y or does not exist
- **THEN** the system SHALL reject the operation with HTTP status 400 Bad Request
- **AND** the task SHALL retain its original column and order state without changes
- **AND** NO activity event SHALL be recorded

#### Scenario: Horizontal isolation on task movement
- **GIVEN** an authenticated user who is either a student not belonging to project X or a teacher not formally assigned to project X
- **WHEN** the user sends a move request for a task belonging to project X
- **THEN** the system SHALL reject the request with HTTP status 404 Not Found
- **AND** SHALL NOT modify the task state

### Requirement: Task fields
Tasks SHALL support title (3 to 140 characters), description (optional, up to 2000 characters), priority (`LOW`, `MEDIUM`, `HIGH`, `URGENT`), due dates (optional ISO-8601 UTC string), labels (array of up to 5 strings, max 30 characters each), order index, creator identifier, and a list of responsible user identifiers.

#### Scenario: Successful task creation
- **GIVEN** an authorized project member
- **AND** a valid task payload containing title, valid columnId belonging to the project, valid priority, and eligible assignees
- **WHEN** the member sends an HTTP `POST /api/projects/:projectId/tasks` request
- **THEN** the system SHALL validate all input fields against the task schema
- **AND** SHALL persist the task with a unique UUID v4 identifier and the requesting user as creator
- **AND** SHALL return HTTP status 201 Created with the full task representation

#### Scenario: Task creation rejected due to invalid fields
- **GIVEN** an authorized project member
- **WHEN** the member submits a task creation request with a title shorter than 3 characters or longer than 140 characters, or an invalid priority value
- **THEN** the system SHALL reject the request with HTTP status 400 Bad Request
- **AND** SHALL return structured validation error messages

### Requirement: List and board views
The system SHALL provide both a full Kanban board view and a tabular list view. The list view SHALL support server-side filtering (by `columnId`, `priority`, `assigneeId`, `label`, and date range), sorting, and server-side pagination with default page size of 20 items (maximum 100 items). Access SHALL be strictly restricted to project members and formally assigned teachers.

#### Scenario: Browse tasks with pagination and filters
- **GIVEN** an authorized project member and multiple tasks existing in the project
- **WHEN** the member requests `GET /api/projects/:projectId/tasks?page=1&limit=20&priority=HIGH`
- **THEN** the system SHALL return HTTP status 200 OK
- **AND** the response body SHALL contain an array of tasks filtered by `HIGH` priority
- **AND** the response SHALL include pagination metadata (`page`, `limit`, `totalItems`, `totalPages`)
- **AND** SHALL NOT return tasks belonging to other projects

#### Scenario: Unauthorized board inquiry
- **GIVEN** an authenticated user who is neither an active member of project X nor a teacher formally assigned to project X
- **WHEN** the user attempts to query `GET /api/projects/:projectId/board` or `GET /api/projects/:projectId/tasks`
- **THEN** the system SHALL reject the inquiry with HTTP status 404 Not Found
- **AND** SHALL NOT disclose board or task existence or metadata

#### Scenario: Unassigned teacher inquiry rejected
- **GIVEN** an authenticated user with institutional TEACHER role who is NOT assigned to project X
- **WHEN** the teacher attempts to query `GET /api/projects/:projectId/board` or `GET /api/projects/:projectId/tasks`
- **THEN** the system SHALL reject the inquiry with HTTP status 404 Not Found
- **AND** SHALL preserve horizontal isolation between academic project scopes

## ADDED Requirements

### Requirement: Task assignment eligibility
The system SHALL verify that any user assigned to a task holds an active membership (owner or collaborator) in the project to which the task belongs.

#### Scenario: Assign an ineligible user
- **GIVEN** an authorized project member creating or updating a task in project X
- **WHEN** the member includes in the assignees list a user identifier that does not have an active membership in project X (e.g. non-member or removed member)
- **THEN** the system SHALL reject the assignment with HTTP status 400 Bad Request
- **AND** SHALL return a specific error message stating that the user is not an active member of the project

#### Scenario: Assign an eligible active member
- **GIVEN** an authorized project member creating or updating a task in project X
- **WHEN** the member assigns a user who holds an active membership in project X (creator/owner or active collaborator)
- **THEN** the system SHALL accept the assignment and persist the relation

### Requirement: Safe column deletion
The system SHALL prevent the accidental or unauthorized deletion of columns that contain tasks, prohibiting the creation of orphaned tasks, and SHALL prevent deleting the last remaining column of a board. Deleting a column with tasks SHALL execute in a single atomic transaction that migrates tasks and logs activity events.

#### Scenario: Deleting a non-empty column without target re-assignment
- **GIVEN** an authorized project member and a board column containing one or more tasks
- **WHEN** the member sends a delete request for the column without specifying a valid target column for task migration
- **THEN** the system SHALL reject the deletion with HTTP status 409 Conflict
- **AND** SHALL inform the client that the column contains active tasks and cannot be removed without reassigning them

#### Scenario: Deleting a column with valid task re-assignment
- **GIVEN** an authorized project member, source column A containing tasks, and an existing destination column B in the same board
- **WHEN** the member sends a delete request for column A specifying `targetColumnId: B`
- **THEN** the system SHALL move all tasks from column A to column B in a single atomic transaction, appending them to column B's task sequence
- **AND** SHALL record an immutable activity event for each moved task reflecting the column re-assignment
- **AND** SHALL delete column A and recompact remaining column sequence indices atomically
- **AND** if any part of the operation or event recording fails, SHALL roll back completely leaving columns and tasks unchanged
- **AND** SHALL return HTTP status 200 OK

#### Scenario: Deleting the last remaining column
- **GIVEN** an authorized project member and a board with exactly one column remaining
- **WHEN** the member attempts to delete that column
- **THEN** the system SHALL reject the deletion with HTTP status 400 Bad Request
- **AND** SHALL return an error message indicating that a project board must maintain at least one column

### Requirement: Accessible Kanban keyboard navigation and assistive announcement
The web user interface SHALL provide full keyboard navigation and accessible assistive announcements compliant with WCAG 2.1 AA for all drag-and-drop operations on the Kanban board.

#### Scenario: Moving a task using keyboard
- **GIVEN** a keyboard-only user focusing a task card on the Kanban board
- **WHEN** the user presses the activation key (Space or Enter), uses arrow keys to navigate to a target column or position, and confirms with Enter/Space
- **THEN** the interface SHALL update the card's position
- **AND** SHALL emit an accessible ARIA live-region announcement describing the movement (card title, source column, target column, new position)
- **AND** SHALL dispatch the move mutation to the API with optimistic updates