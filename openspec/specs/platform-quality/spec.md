# Platform Quality and Delivery

## Purpose
Define testability, performance, security, deployment, and operational quality requirements.

## Requirements

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

### Requirement: Automated tests and quality gates
The repository CI pipeline SHALL enforce strict OpenSpec validation, automated linting, strict TypeScript typechecking, unit/integration test execution, and production build verification on all pull requests targeting `main`.

#### Scenario: Quality or compilation defects in pull request
- **WHEN** a pull request contains linting errors, TypeScript typecheck failures, failing tests, or build errors
- **THEN** the CI pipeline SHALL fail and block integration into `main`

#### Scenario: Pull request passing all quality gates
- **WHEN** a pull request satisfies strict OpenSpec validation, passes linter checks, compiles without TypeScript errors, passes all automated tests, and successfully executes the build command
- **THEN** the CI pipeline SHALL mark the check suite as successful and allow progression to review

### Requirement: API contract
The API SHALL publish an OpenAPI contract and keep it aligned with implemented routes and schemas.

#### Scenario: Contract mismatch
- **WHEN** a change breaks the documented API contract
- **THEN** contract validation SHALL fail before production deployment

### Requirement: Secure deployment
Production SHALL be deployed over HTTPS from a validated `main` revision and shall not use secrets committed to source control.

#### Scenario: Post-deployment check
- **WHEN** a production deployment completes
- **THEN** the pipeline SHALL execute lightweight smoke checks and record the deployed revision

### Requirement: Controlled load testing
Load tests SHALL run in staging with synthetic data; production checks SHALL be lightweight.

#### Scenario: Load test
- **WHEN** the load-test workflow runs
- **THEN** it SHALL report concurrency, duration, p95 latency, error rate, and resource/plan limits
- **AND** SHALL not target production

### Requirement: Privacy-safe caching
Private authenticated responses SHALL not be cached in shared CDN caches by default.

#### Scenario: Private response
- **WHEN** an authenticated endpoint returns project data
- **THEN** the response SHALL use a private/no-store policy unless an explicit safe caching policy is approved
