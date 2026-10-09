# Collaboration and Reviews

## Purpose
Capture project progress, task comments, deliverable metadata, and teacher feedback.

## Requirements

### Requirement: Progress update
Authorized project members SHALL be able to record dated progress updates linked to a project.

#### Scenario: Add progress
- **WHEN** an authorized member submits a valid progress update
- **THEN** the system SHALL persist its author, project, content, and timestamp

### Requirement: Deliverable metadata
The system SHALL allow users to register deliverables using metadata and links in the initial release; binary file uploads are deferred.

#### Scenario: Register a deliverable link
- **WHEN** an authorized member submits a valid deliverable with a link or reference
- **THEN** the system SHALL persist the metadata and deadline
- **AND** SHALL apply project access controls to its visibility

### Requirement: Teacher review
An authorized teacher SHALL be able to record observations and review status for assigned projects.

#### Scenario: Review deliverable
- **WHEN** the assigned teacher submits a review
- **THEN** the system SHALL persist the review and notify relevant project members according to notification settings
