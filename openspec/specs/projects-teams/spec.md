# Projects and Teams

## Purpose
Manage academic projects, courses, memberships, and responsible teachers.

## Requirements

### Requirement: Project creation
The system SHALL allow an authorized user to create a project with a title, description, course, relevant dates, and initial membership.

#### Scenario: Create a project
- **WHEN** an authorized student submits valid project details
- **THEN** the system SHALL persist the project and its creator membership
- **AND** SHALL return a stable project identifier

### Requirement: Project membership
The system SHALL maintain explicit membership and project-level roles.

#### Scenario: Add a member
- **WHEN** an authorized project member adds an eligible user
- **THEN** the system SHALL create one membership record
- **AND** SHALL prevent duplicate membership for the same project and user

### Requirement: Teacher scope
The system SHALL limit teacher review and reporting to projects assigned to that teacher or otherwise explicitly authorized.

#### Scenario: Teacher outside assignment
- **WHEN** a teacher accesses a project outside their assigned scope
- **THEN** the system SHALL deny access unless an explicit administrative permission applies
