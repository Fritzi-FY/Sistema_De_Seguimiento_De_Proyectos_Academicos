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
A task SHALL belong to exactly one project and one valid column within that project's board. The server SHALL be the sole authority for validating and executing task transitions and ordering. Moving a task SHALL be atomic within a single transactional boundary, SHALL sequentially adjust order indices within columns to maintain contiguous 0-indexed positions without gaps or duplicates, and SHALL record an immutable task activity event with the actor, source column, destination column, timestamp, and index transition details (`fromIndex`, `toIndex`). Any real change of position (inter-column move or intra-column reordering) SHALL update the task's `updatedAt` timestamp and generate exactly one `MOVED` activity event. If the destination column and effective destination index resolve to the task's current position, the operation SHALL be treated as an idempotent no-op without updating `updatedAt`, without recording an activity event, and without publishing state changes. If any step of an effective move fails, the entire operation SHALL roll back without partial state.

#### Scenario: Move task between columns
- **GIVEN** an authorized member and an existing task at position `fromIndex` in column A of the project
- **WHEN** the member sends a move request specifying a valid destination column B (different from column A) within the same project board and a destination order index
- **THEN** the system SHALL update the task's column, order index, and `updatedAt` timestamp atomically
- **AND** SHALL adjust sibling task order indices in both column A and column B to preserve sequential contiguous 0-indexed ordering without gaps or duplicates
- **AND** SHALL record exactly one immutable activity event with action `MOVED`, actor, source column, destination column, timestamp, and details capturing `fromIndex` and `toIndex`
- **AND** SHALL return HTTP status 200 OK with the updated task representation

#### Scenario: Move task within the same column (intra-column reordering)
- **GIVEN** an authorized member and an existing task at position `fromIndex` in column A
- **WHEN** the member sends a move request specifying the same column A and a destination index resulting in a different effective position `toIndex`
- **THEN** the system SHALL update the task's order index and `updatedAt` timestamp atomically
- **AND** SHALL adjust sibling task order indices in column A to preserve sequential contiguous 0-indexed ordering without gaps or duplicates
- **AND** SHALL record exactly one immutable activity event with action `MOVED`, actor, source column, destination column (equal to source column), timestamp, and details capturing `fromIndex` and `toIndex`
- **AND** SHALL return HTTP status 200 OK with the updated task representation

#### Scenario: Move task to the same effective position (no-op)
- **GIVEN** an authorized member and an existing task in column A
- **WHEN** the member sends a move request specifying the same column A and a destination index that resolves to the task's current effective position
- **THEN** the system SHALL treat the operation as an idempotent no-op without modifying task data, without updating `updatedAt`, and without publishing state changes
- **AND** NO activity event SHALL be recorded
- **AND** the system SHALL return HTTP status 200 OK with the current task representation

#### Scenario: Destination order index clamping
- **GIVEN** an authorized member and an existing task in the project board
- **WHEN** the member sends a move request with a non-negative destination order index greater than the maximum index of the destination column (calculated over the destination list excluding the task being moved)
- **THEN** the system SHALL clamp the destination order index to the end of the destination column (effective index equal to the count of remaining destination tasks)
- **AND** SHALL execute the move and contiguous reordering preserving sequential 0-indexed ordering

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

#### Scenario: Successful partial task update
- **GIVEN** an authorized project member and an existing task in project X
- **WHEN** the member submits an update request providing a subset of editable fields (`title`, `description`, `priority`, `dueDate`, `labels`, `assigneeIds`)
- **THEN** the system SHALL update the specified fields and recompute `updatedAt` using the system clock atomically under the shared project mutex
- **AND** SHALL preserve the values of all omitted fields without modification
- **AND** SHALL record exactly one immutable activity event with action `UPDATED` containing the modified field details
- **AND** SHALL return HTTP status 200 OK with the updated task representation

#### Scenario: Clearing task fields (empty semantics)
- **GIVEN** an authorized project member and an existing task with populated description, dueDate, labels, and assignees
- **WHEN** the member submits an update with `description: ""` (empty string), `dueDate: null`, `labels: []`, or `assigneeIds: []`
- **THEN** the system SHALL clear the corresponding fields (setting description and dueDate to undefined/null, and labels/assigneeIds to empty arrays)
- **AND** SHALL update `updatedAt` and record an `UPDATED` activity event atomically

#### Scenario: Idempotent task update with identical values (no-op)
- **GIVEN** an authorized project member and an existing task
- **WHEN** the member submits an update request whose values match the current task state exactly
- **THEN** the system SHALL treat the operation as an idempotent no-op without modifying task data, without changing `updatedAt`, without recording an activity event, and without publishing state changes
- **AND** SHALL return HTTP status 200 OK with the current task representation

#### Scenario: Protected fields modification rejected on update
- **GIVEN** an authorized project member and an existing task
- **WHEN** the member attempts to modify identity (`id`), project (`projectId`), creator (`creatorId`), or movement fields (`columnId`, `orderIndex`) via the task update endpoint
- **THEN** the system SHALL reject the request with HTTP status 400 Bad Request, indicating that structural and movement fields cannot be modified via task update
- **AND** SHALL leave the task unchanged without recording an activity event

#### Scenario: Task update rejected for ineligible assignees
- **GIVEN** an authorized project member and an existing task in project X
- **WHEN** the member submits an update with an `assigneeIds` list containing any user who is not an active member of project X (e.g. non-member, removed member, or user from another project)
- **THEN** the system SHALL reject the update with HTTP status 400 Bad Request (`IneligibleAssigneeError`)
- **AND** NO changes SHALL be persisted

#### Scenario: Horizontal isolation on task update
- **GIVEN** an authenticated user who is neither an active member of project X nor a teacher formally assigned to project X, or a request targeting a task that belongs to another project Y
- **WHEN** the user attempts to update a task in project X
- **THEN** the system SHALL reject the request with HTTP status 404 Not Found
- **AND** SHALL NOT modify the task state

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

### Resolved ambiguities for list view (3.7)

The following decisions were resolved before implementation:

1. **Default sort order**: Tasks SHALL be sorted by (columnId ascending lexicographic, orderIndex ascending, createdAt ascending). Stable across calls.
2. **Search semantics**: Case-insensitive substring match on title AND description. A task matches if either field contains the search string.
3. **Date range filter**: NOT in v1. ListTasksQuerySchema does not define startDate/endDate.
4. **totalPages when empty**: totalPages = ceil(totalItems / limit); 0 if totalItems is 0.
5. **Filter AND semantics**: All active filters combine with AND logic. Filtering before pagination; totalItems reflects filtered count.
6. **No mutations**: Listing SHALL NOT modify task state or record activity events.

#### Scenario: Deterministic ordered list with pagination
- **GIVEN** an authorized project member and multiple tasks across multiple columns
- **WHEN** the member requests GET /api/projects/:projectId/tasks?page=1&limit=N
- **THEN** the system SHALL return tasks ordered by (columnId lexicographic, orderIndex, createdAt)
- **AND** the order SHALL be stable and reproducible across identical requests
- **AND** totalItems SHALL reflect the count of all matching tasks
- **AND** totalPages SHALL equal ceil(totalItems / limit) or 0 if no tasks match

#### Scenario: Search filter on title and description
- **GIVEN** an authorized project member
- **WHEN** the member requests with search=<term>
- **THEN** the system SHALL return tasks whose title OR description contains <term> as a case-insensitive substring

#### Scenario: Combined filters
- **GIVEN** an authorized project member
- **WHEN** the member provides multiple filter parameters simultaneously
- **THEN** ALL active filters SHALL be applied together (AND logic)
- **AND** totalItems SHALL reflect only tasks satisfying all active filters

#### Scenario: No mutations on list
- **GIVEN** any authorized member
- **WHEN** the member lists tasks
- **THEN** the system SHALL NOT modify any task, board, or membership data
- **AND** SHALL NOT record any activity event
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