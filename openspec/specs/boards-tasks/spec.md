# Boards and Tasks

## Purpose
Provide configurable Kanban boards and task management for academic projects.

## Requirements

### Requirement: Project board
Each project SHALL have a board containing ordered columns with configurable names and visual properties.

#### Scenario: Configure a column
- **WHEN** an authorized member creates or renames a column
- **THEN** the system SHALL persist the configuration and its ordering
- **AND** SHALL enforce configured limits and permissions

### Requirement: Task lifecycle
A task SHALL belong to one project and one valid column in that project's board.

#### Scenario: Move task
- **WHEN** an authorized member moves a task to a valid column in the same board
- **THEN** the system SHALL persist the destination and ordering
- **AND** SHALL record a task activity event

#### Scenario: Invalid destination
- **WHEN** a task is moved to a column belonging to another project
- **THEN** the system SHALL reject the operation without changing task state

### Requirement: Task fields
Tasks SHALL support title, description, priority, due dates, labels, ordering, and responsible users according to project permissions.

#### Scenario: Assign a responsible user
- **WHEN** a member assigns a task to a user who is not eligible for the project
- **THEN** the system SHALL reject the assignment

### Requirement: List and board views
The system SHALL provide Kanban and list views with server-side pagination and filtering for large collections.

#### Scenario: Browse tasks with pagination and filters
- **WHEN** an authorized member opens the board or list view and applies pagination or supported filters
- **THEN** the system SHALL return only the tasks matching the requested page and filters
- **AND** SHALL apply pagination and filtering on the server side
- **AND** SHALL enforce project permissions when returning task data
