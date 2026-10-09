# Audit, Notifications, and Reporting

## Purpose
Provide traceability and project progress visibility.

## Requirements

### Requirement: Audit relevant changes
The system SHALL record relevant changes with actor, action, resource identifier, timestamp, and correlation identifier when available.

#### Scenario: Record task change
- **WHEN** a user creates, edits, moves, or deletes a task
- **THEN** the system SHALL record an audit/activity event
- **AND** SHALL NOT store passwords, tokens, cookies, or secrets in the event

### Requirement: Internal notifications
The system SHALL generate internal notifications for configured relevant events such as upcoming deadlines and teacher observations.

#### Scenario: Notify about review
- **WHEN** a teacher posts an observation on a deliverable
- **THEN** the system SHALL create a notification for the authorized relevant project members

### Requirement: Permission-aware reporting
Reports SHALL aggregate only data the requesting user is authorized to access.

#### Scenario: Request unauthorized report
- **WHEN** a user requests a report for a course or project outside their scope
- **THEN** the system SHALL deny the request or return only the authorized subset
