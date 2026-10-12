## ADDED Requirements

### Requirement: Service diagnostic health check
The system SHALL provide an unauthenticated health check endpoint at `GET /api/health` that reports operational availability, current server timestamp in ISO-8601 format, and the active system version.

#### Scenario: Successful health inquiry
- **WHEN** any client performs an HTTP `GET` request to `/api/health`
- **THEN** the system SHALL respond with HTTP status 200
- **AND** the response body SHALL contain a JSON payload conforming to `{ "status": "ok", "timestamp": string, "version": string }`
- **AND** the response SHALL include headers preventing unauthenticated responses from being cached incorrectly (`Cache-Control: no-cache, no-store, must-revalidate`)

#### Scenario: Unsupported HTTP method on health endpoint
- **WHEN** a client issues a `POST`, `PUT`, `PATCH`, or `DELETE` request to `/api/health`
- **THEN** the system SHALL reject the request with HTTP status 405 Method Not Allowed
- **AND** the system SHALL NOT disclose internal stack traces or environment variables

### Requirement: Executable baseline CI gates
The repository CI pipeline SHALL enforce automated linting, strict TypeScript typechecking, unit/integration test execution, and production build verification on all pull requests targeting `main`.

#### Scenario: Pull request with quality or compilation defects
- **WHEN** a pull request contains linting errors, TypeScript typecheck failures, failing tests, or build errors
- **THEN** the CI pipeline SHALL fail and block integration into `main`

#### Scenario: Pull request passing all quality gates
- **WHEN** a pull request satisfies strict OpenSpec validation, passes linter checks, compiles without TypeScript errors, passes all automated tests, and successfully executes the build command
- **THEN** the CI pipeline SHALL mark the check suite as successful and allow progression to review
