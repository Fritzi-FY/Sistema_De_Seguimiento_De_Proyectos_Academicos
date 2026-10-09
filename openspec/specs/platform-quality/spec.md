# Platform Quality and Delivery

## Purpose
Define testability, performance, security, deployment, and operational quality requirements.

## Requirements

### Requirement: Automated tests
The repository SHALL run unit and integration tests in CI before merge to `main`.

#### Scenario: Test failure
- **WHEN** a required test or typecheck fails in a pull request
- **THEN** the pipeline SHALL fail and block the merge according to repository rules

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
