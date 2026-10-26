## Purpose

## Precisiones consolidadas del movimiento Kanban

El movimiento de tareas forma parte de este cambio y reutiliza el endpoint existente. El cliente envia solo `destinationColumnId` y `destinationIndex`, mantiene ordenes contiguos, serializa mutaciones del tablero, ignora respuestas tardias y restaura el snapshot ante fallos sin reintento automatico. El control de arrastre es independiente de Editar y soporta puntero, teclado, Escape, foco restaurado, anuncios accesibles y destinos vacios.

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

The system SHALL provide both a full Kanban board view and a tabular list view. The list view SHALL support server-side filtering by `columnId`, `priority`, `assigneeId`, `label` and search, the deterministic server order defined in the resolved decisions below, and server-side pagination with default page size of 20 items (maximum 100 items). Date ranges remain outside v1 as already resolved below. Access SHALL be strictly restricted to project members and formally assigned teachers.

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

### Requirement: Reliable and accessible task movement

The Kanban client SHALL support pointer and keyboard movement with serialized optimistic state, exact rollback, stale-response isolation, and a dedicated accessible drag control.

#### Scenario: Pointer move across columns

- **GIVEN** an authorized member and a task card with a dedicated drag control
- **WHEN** the member drags the control within the source column, over another column, or into an empty column and releases it
- **THEN** the client SHALL calculate the effective destination index and apply the visible move optimistically
- **AND** SHALL send only `destinationColumnId` and `destinationIndex` to the existing move endpoint
- **AND** SHALL keep rendered order and affected column counters contiguous without duplicates

#### Scenario: Optimistic move rollback

- **GIVEN** an optimistic move is pending
- **WHEN** the move request fails, the response is invalid, or its `id`/`projectId` does not match the request
- **THEN** the client SHALL restore the exact pre-move order and column membership
- **AND** SHALL state that the movement could not be confirmed and that the board must be checked before repeating
- **AND** SHALL NOT retry automatically

#### Scenario: Serializing board mutations

- **GIVEN** a move request is pending
- **WHEN** the member attempts another move, task creation, or task editing
- **THEN** the client SHALL reject or ignore the concurrent operation through a logic guard
- **AND** SHALL disable the corresponding controls until the pending move resolves or is invalidated

#### Scenario: Ignoring stale move responses

- **GIVEN** a move request is pending for project A
- **WHEN** the project changes, a newer operation supersedes it, or the board unmounts
- **THEN** a later resolution or rejection of the old request SHALL NOT alter current tasks, errors, submission state, modal, or the current project board

#### Scenario: Keyboard activation, navigation and confirmation

- **GIVEN** an authorized member focuses the dedicated drag control on a loaded board
- **WHEN** the member activates dragging with Space or Enter, navigates within or across columns with arrow keys, and confirms a different effective destination with Space or Enter
- **THEN** the client SHALL send only `destinationColumnId` and `destinationIndex` to the existing move endpoint
- **AND** SHALL apply the same optimistic confirmation and rollback semantics as pointer movement
- **AND** SHALL announce activation, destination and outcome through an `aria-live` region
- **AND** SHALL retain visible focus on the moved task's drag control after confirmation

#### Scenario: Dedicated drag control and Escape cancellation

- **GIVEN** a task card exposes separate Edit and drag controls
- **WHEN** a keyboard user activates dragging from the drag control and presses Escape before confirmation
- **THEN** the move SHALL be cancelled without a request
- **AND** the original task order, column membership and counters SHALL remain unchanged
- **AND** focus SHALL return to the drag control
- **AND** activating Edit SHALL NOT initiate a drag operation

#### Scenario: Effective no-op

- **GIVEN** a task is released or confirmed at its current effective column and index
- **WHEN** the client calculates the destination
- **THEN** the client SHALL NOT send a move request
- **AND** SHALL NOT change local tasks, order, column membership or counters
- **AND** SHALL NOT announce a successful mutation

## ADDED Requirements

### Requirement: Task detail assignee editing

The existing task detail editor SHALL display current assignee IDs from TaskResponse and obtain candidate members from the existing project members endpoint. New assignments SHALL be limited to active members of the current project with IDs compatible with the task contract. The client SHALL NOT invent member display names or activity events.

#### Scenario: Assign or remove responsible users

- **GIVEN** an open task editor and active project members
- **WHEN** a member changes responsible users and saves
- **THEN** the client SHALL validate and send only changed fields through the existing PATCH endpoint
- **AND** assigneeIds SHALL be omitted if the set is unchanged and SHALL be [] if all assignments are removed
- **AND** current assignments absent from active candidates SHALL remain visible and removable
- **AND** duplicate submissions SHALL be prevented and the view selector SHALL remain blocked until mutation settlement

#### Scenario: Member loading, errors and obsolete requests

- **WHEN** candidate members are requested
- **THEN** loading, empty and error with retry SHALL be accessible without clearing task fields or current assignments
- **AND** obsolete resolutions and rejections after closing, switching task/project or unmounting SHALL NOT modify current candidates, errors or loading state
- **AND** members whose IDs cannot satisfy the task contract SHALL be identified without allowing their assignment

#### Scenario: Real activity history

- **GIVEN** an authorized member and an existing task
- **WHEN** the member opens task details
- **THEN** the client SHALL query GET /api/projects/:projectId/tasks/:taskId/activity and display real events with accessible loading, empty, error and retry states
- **AND** obsolete resolutions and rejections after task/project changes or unmounting SHALL NOT alter current history even when abort does not stop transport

### Requirement: Context-isolated activity read and creation assignees

Activity reads SHALL use existing authentication and project access rules, verify task ownership, return a shared-schema list ordered by createdAt descending then id ascending, and SHALL NOT mutate state or record events.

#### Scenario: Scoped activity read

- **WHEN** a requester queries activity for a task
- **THEN** missing authentication SHALL return 401 and malformed UUIDs SHALL return 400
- **AND** missing project/task, another project's task, non-member, inactive member or unassigned teacher SHALL return the same 404
- **AND** an authorized read SHALL return only matching project/task events with no-store, including an empty list if no events exist

#### Scenario: Responsible users in creation

- **WHEN** a member creates a task with selected active project members
- **THEN** the client SHALL reuse the member picker, preserve exact UUIDs and validate the existing creation contract
- **AND** duplicate sends SHALL be prevented and the view selector SHALL remain blocked until settlement
- **AND** incompatible IDs SHALL NOT be converted or accepted by relaxing UUID validation, nor SHALL existing assignments be silently omitted

### Requirement: Server-side List filters

The List SHALL support search, column, priority, exact label and responsible user UUID (`assigneeId`) filters combined with AND on the server through getTasks with limit 20, preserving server order. Empty values SHALL be omitted and contract limits SHALL be validated before submitting.

#### Scenario: Apply, clear and paginate

- **GIVEN** a list on a later page and draft filter values
- **WHEN** the member applies or clears filters
- **THEN** applied filters and page 1 SHALL be updated together without querying the old page with new filters
- **AND** pagination and retry SHALL retain applied filters independently of draft edits

#### Scenario: Empty and accessible feedback

- **WHEN** no tasks match the applied filters
- **THEN** List SHALL announce Sin coincidencias without displaying Página 1 de 0 and SHALL disable pagination
- **AND** loading and errors SHALL have accessible feedback and retry

#### Scenario: Independent columns lookup

- **WHEN** List loads column options through getBoard
- **THEN** column loading, error and retry SHALL be independent of task queries
- **AND** options SHALL NOT be inferred from visible tasks

#### Scenario: Obsolete filter and column responses

- **WHEN** filters, project or view change, or a newer lookup supersedes a pending request
- **THEN** obsolete resolutions and rejections SHALL NOT change current tasks, options, errors or loading state, even if abort does not stop the request
- **AND** changing project or reentering List SHALL start with cleared filters and page 1
- **AND** Board mutations SHALL continue blocking the view selector until settlement

### Requirement: Read-only paginated task list

The client SHALL provide a read-only list using `getTasks` with server pagination and limit 20 and the server-side filters specified above, without `getAllProjectTasks`, new sorting or list mutations. It SHALL preserve the returned order and display server `totalItems`, `page`, `limit` and `totalPages`. The earlier increment without filters is superseded by the approved filter increments.

#### Scenario: Enter and browse List

- **WHEN** an authorized member selects List in ProjectDetail
- **THEN** the client SHALL request page 1 again, including on every subsequent entry after board mutations
- **AND** Previous and Next SHALL request only the corresponding server page and be disabled at boundaries and while loading
- **AND** the client SHALL NOT paginate or reorder an exhaustive local task collection

#### Scenario: Loading, empty and retry

- **WHEN** a page is requested
- **THEN** the client SHALL display an accessible loading state without presenting previous rows as current
- **AND** an empty response SHALL show an empty state
- **AND** failure SHALL show an accessible error and a Retry control that requests the same page

#### Scenario: Project reset and stale responses

- **WHEN** the project changes
- **THEN** the client SHALL reset the view to Board and discard prior list data, errors and page state
- **AND** a later List entry SHALL request page 1 for the new project
- **AND** late resolutions or rejections after changing page, project, view or unmounting SHALL NOT change current data, errors or loading state

#### Scenario: Pending board mutation blocks view changes

- **GIVEN** a task creation, edit or move is pending on Board
- **WHEN** the member attempts to change views
- **THEN** the selector SHALL remain disabled with an accessible pending indication
- **AND** the board SHALL remain mounted until the operation resolves or rejects
- **AND** the selector SHALL become available after settlement without changing the accepted mutation behavior

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

### Requirement: Stable UUID development identities

Development consumers SHALL use explicit stable UUID identities coherently across project creation, memberships, board, tasks, activity and frontend ownership checks, preserving existing contracts and permissions.

#### Scenario: Assignment with the configured development identity

- **GIVEN** the configured development student creates a project
- **WHEN** the owner is assigned on task creation and another active UUID member is assigned on edit
- **THEN** exact UUIDs SHALL be preserved and actual CREATED and UPDATED activity SHALL retain the requesting actor and assignment details

#### Scenario: Separate identities and existing data

- **GIVEN** distinct student and teacher development UUIDs and existing textual identities
- **WHEN** they access projects or attempt assignment without active membership
- **THEN** existing authorization and UUID validation SHALL remain enforced
- **AND** textual IDs SHALL NOT be converted, migrated, deleted or treated as the new UUID identity
- **AND** development identity headers SHALL remain disabled in production

### Requirement: Accessible frontend column management

The frontend SHALL reuse existing column endpoints and schemas to create named categorized columns, rename them, reorder them with keyboard accessible controls and delete with explicit confirmation, preserving backend permissions and restrictions.

#### Scenario: Confirmed column changes across views

- **GIVEN** the initial three columns and an authorized project user
- **WHEN** the user optionally creates an IN_REVIEW column, renames or reorders a column
- **THEN** only valid server confirmation and subsequent reads SHALL update the board
- **AND** entering List SHALL fetch current column filter options

#### Scenario: Confirmed deletion with existing backend semantics

- **GIVEN** more than one column
- **WHEN** deletion is confirmed and an explicit destination is supplied for a nonempty column
- **THEN** the client SHALL delegate deletion and task reallocation to the existing backend
- **AND** SHALL refresh columns and tasks without inventing local reallocation semantics
- **AND** SHALL prevent deletion of the last column and display backend rejection without success

#### Scenario: Pending, failed and obsolete column operations

- **WHEN** a column mutation is pending, fails or settles after project change or unmount
- **THEN** duplicate submissions and incompatible task/column mutations SHALL be blocked
- **AND** errors SHALL be visible, obsolete results SHALL be ignored and uncertain mutations SHALL NOT be automatically retried

### Requirement: Contextual refresh and responsible user filter

The existing task view controls SHALL provide refresh of the active view and the List SHALL expose the existing assigneeId UUID filter, without adding list mutations or changing server contracts.

#### Scenario: Refresh applied filters independently of draft edits

- **GIVEN** a List with applied assigneeId and another draft value not yet applied
- **WHEN** the member refreshes the List from the contextual controls
- **THEN** the same applied query and page SHALL be fetched and the draft SHALL remain independent
- **AND** applying or clearing filters SHALL atomically restart page 1

#### Scenario: Responsible UUID validation and pending writes

- **WHEN** a textual or malformed responsible ID is applied
- **THEN** validation SHALL show an error without dispatching that query
- **AND** contextual refresh and view switches SHALL be disabled while incompatible writes are pending
