## MODIFIED Requirements

### Requirement: Institutional identity

The system SHALL support Google OAuth for accounts whose email is verified and matches the configured institutional domain policy. The backend SHALL validate provider assertions and resolve an internal UUID before establishing an authorized application session. An email domain SHALL NOT grant a teacher or administrator role.

#### Scenario: Accepted institutional identity

- **GIVEN** an eligible verified Google identity linked to an enabled internal user with an authorized role
- **WHEN** the backend validates the callback and identity claims
- **THEN** it SHALL establish a session for that UUID and apply only the server-authorized role

#### Scenario: Rejected identity domain

- **WHEN** a user authenticates with an email outside the allowed domain
- **THEN** the system SHALL deny institutional access and SHALL NOT create an active institutional session

#### Scenario: Forged or replayed callback

- **WHEN** signature, issuer, audience, validity, state, nonce or required PKCE validation fails
- **THEN** the system SHALL reject the callback without linking an identity or establishing a session

### Requirement: Email credential alternative

The system SHALL support email/password authentication with email verification when a transactional email provider is configured. It SHALL use a mature reviewed credential implementation and SHALL preserve this alternative when federation is enabled. Initial accounts SHALL be preauthorized through an administrative provisioning tool. Only provisioned emails SHALL be eligible, and public registration SHALL be disabled. Roles SHALL be granted by an explicit server administrative authority.

#### Scenario: Unverified email

- **WHEN** a user attempts to use a password account whose email is not verified
- **THEN** the system SHALL prevent protected project access and provide a controlled verification path

#### Scenario: Verified eligible local account

- **GIVEN** a provisioned enabled user satisfying the approved local eligibility policy
- **WHEN** the user submits a valid credential and completes email verification
- **THEN** the system SHALL allow the same session and protected application flow used by federation

#### Scenario: Missing email configuration or invalid verification proof

- **WHEN** real email delivery is unconfigured or verification proof is expired, invalid or already consumed
- **THEN** the system SHALL NOT bypass verification or activate an institutional session
- **AND** a test mail adapter SHALL NOT be enabled implicitly in production

#### Scenario: Password recovery

- **WHEN** a password reset is confirmed with a valid unexpired single-use proof
- **THEN** the system SHALL update the credential through the reviewed library and revoke previous sessions
- **AND** invalid proofs and account lookup responses SHALL NOT disclose account existence

### Requirement: Server-side authorization

The system SHALL validate current session, user status, server-authorized role and resource-level permissions on every protected operation. Client identity claims SHALL NOT replace those checks.

#### Scenario: Unauthorized project access

- **WHEN** a user requests a project without membership or explicit permission
- **THEN** the system SHALL deny the request without disclosing private project data

#### Scenario: Bypass through direct API or development headers

- **GIVEN** session authentication mode
- **WHEN** a request has no valid session but supplies a user UUID, role, development header or Access service token
- **THEN** protected API operations SHALL reject it before product access
- **AND** production SHALL NOT fall back to development authentication

### Requirement: Privilege assignment

The system SHALL prevent users from granting themselves teacher or administrator privileges. Global roles SHALL come from an explicitly authorized server source separate from editable profile and identity-provider claims.

#### Scenario: Self-promotion attempt

- **WHEN** a student submits a request or provider claim attempting to become teacher or administrator
- **THEN** the system SHALL reject the elevation and record a security-relevant event without secrets

#### Scenario: Institutional teacher email without a grant

- **GIVEN** an identity with a verified institutional email and no teacher grant
- **WHEN** the user signs in
- **THEN** the system SHALL NOT infer teacher privilege from email, domain, hosted-domain claim or name
- **AND** teacher assignment to a project SHALL remain a separate authorization relationship

## ADDED Requirements

### Requirement: Stable internal identity and explicit linking

The system SHALL expose a server-generated internal UUID and map each validated external identity uniquely by provider, issuer and subject. It SHALL NOT merge users solely because emails match or reassign historical actors implicitly.

#### Scenario: Stable subject after email change

- **GIVEN** an external identity already linked to an internal UUID
- **WHEN** a later valid login has the same issuer and subject but changed contact email
- **THEN** the mapping SHALL retain that UUID and SHALL re-evaluate current login eligibility
- **AND** it SHALL NOT silently overwrite a conflicting primary email or transfer another user's data

#### Scenario: Explicit ownership proof and competing links

- **GIVEN** an authenticated internal user who freshly proves both the current credential and new external identity
- **WHEN** linking succeeds
- **THEN** the mapping SHALL commit atomically to that UUID
- **AND** concurrent attempts to bind the same identity to different users SHALL leave at most one binding

#### Scenario: Email collision without proof

- **WHEN** an unknown external identity has an email already associated with a user but no linking proof
- **THEN** the system SHALL NOT merge, grant that user's role or establish that user's session

### Requirement: Authoritative session lifecycle

The system SHALL establish, rotate, expire and revoke sessions using a reviewed implementation and persistent server authority. It SHALL enforce an absolute lifetime of at most eight hours, without remember-me or automatic extension of that deadline, and SHALL NOT retain an authoritative role only in a client cookie or global Worker memory.

#### Scenario: User identity and browser reload

- **GIVEN** an enabled user with a valid session
- **WHEN** the browser requests the current-user endpoint or reloads the application
- **THEN** the server SHALL return the internal UUID, minimum permitted profile and current authorized role without exposing credentials

#### Scenario: Expiration or server privilege change

- **WHEN** a session expires, the user is disabled or a server role is revoked
- **THEN** subsequent protected requests SHALL reject the session or revoked privilege without trusting stale client state
- **AND** subsequent requests SHALL NOT extend the absolute deadline

#### Scenario: Confirmed logout and reuse

- **WHEN** logout successfully revokes the session
- **THEN** the browser cookie SHALL expire and subsequent use of the previous session SHALL fail
- **AND** repeated logout SHALL remain safe and idempotent

#### Scenario: Logout transport failure

- **WHEN** revocation cannot be confirmed
- **THEN** the UI SHALL NOT claim confirmed server logout or automatically replay another product mutation
- **AND** no guarantee SHALL be made to cancel already-authorized in-flight writes retroactively

### Requirement: Browser request protection and secret confinement

The system SHALL use secure HttpOnly session cookies, approved SameSite policy, constrained cookie scope and explicit CSRF/origin protection. Private responses SHALL disable shared caching. Credential attempts SHALL have configured limits and controlled errors.

#### Scenario: Cross-origin mutation or replayed verification

- **WHEN** a protected mutation lacks valid CSRF/origin proof or a verification token is replayed
- **THEN** the system SHALL reject it without changing identity, credential, session or project data

#### Scenario: Cookies and browser storage

- **WHEN** a session is established on the supported HTTPS origin
- **THEN** the browser SHALL receive a Secure HttpOnly cookie with the approved SameSite and scope attributes
- **AND** durable session tokens SHALL NOT be stored in localStorage or returned by the current-user endpoint

#### Scenario: Attempt limit and secret-safe diagnostics

- **WHEN** authentication or verification exceeds its configured attempt limit
- **THEN** the server SHALL enforce the limit without enumerating accounts
- **AND** logs SHALL omit passwords, cookies, verification proofs and provider tokens

### Requirement: Frontend session gate

The frontend SHALL determine access through the current-user endpoint and SHALL NOT treat hidden navigation as API authorization.

#### Scenario: Initial request or expired session

- **WHEN** session status is unresolved or the API returns an unauthenticated response
- **THEN** the frontend SHALL withhold protected content, clear stale user-specific state and offer the appropriate login flow
- **AND** a network error SHALL NOT be treated as a valid authenticated session

#### Scenario: Authorized transition and return path

- **WHEN** login succeeds and the server confirms the current user
- **THEN** the frontend SHALL open an allowed local protected route using that UUID and server role
- **AND** arbitrary external return URLs SHALL be rejected
