# Identity and Access

## Purpose
Define institutional authentication and authorization for students, teachers, and administrators.

## Requirements

### Requirement: Institutional identity
The system SHALL support Google OAuth for accounts whose email is verified and matches the configured institutional domain policy.

#### Scenario: Accepted institutional identity
- **WHEN** a user authenticates through Google and the identity provider confirms a verified email in the allowed domain
- **THEN** the system SHALL establish a session according to the configured session policy
- **AND** SHALL apply the user's already-authorized role

#### Scenario: Rejected identity domain
- **WHEN** a user authenticates with an email outside the allowed domain
- **THEN** the system SHALL deny access to institutional features
- **AND** SHALL not create an active institutional session

### Requirement: Email credential alternative
The system SHALL support email/password authentication with email verification when a transactional email provider is configured.

#### Scenario: Unverified email
- **WHEN** a user attempts to use a password account whose email is not verified
- **THEN** the system SHALL prevent access to protected project functionality
- **AND** SHALL provide a controlled verification path

### Requirement: Server-side authorization
The system SHALL validate role and resource-level permissions on every protected operation.

#### Scenario: Unauthorized project access
- **WHEN** a user requests a project for which they have no membership or explicit permission
- **THEN** the system SHALL deny the request without disclosing private project data

### Requirement: Privilege assignment
The system SHALL prevent users from granting themselves teacher or administrator privileges.

#### Scenario: Self-promotion attempt
- **WHEN** a student submits a request to change their role to teacher or administrator
- **THEN** the system SHALL reject the request and record a security-relevant event
