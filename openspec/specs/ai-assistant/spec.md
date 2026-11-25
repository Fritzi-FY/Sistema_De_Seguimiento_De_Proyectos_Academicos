# AI Assistant

## Purpose
Provide optional AI-assisted summaries and planning suggestions through an interchangeable provider interface.
## Requirements
### Requirement: Provider abstraction
The system SHALL access AI capabilities through an internal `AIProviderPort` interface with OpenRouter as the initial infrastructure adapter. Application use cases and domain models SHALL NOT import or depend on provider-specific SDK types, direct network endpoints, or vendor wire schemas.

#### Scenario: Provider replacement
- **GIVEN** an application use case invoking AI capabilities
- **WHEN** the infrastructure provider is replaced or reconfigured from OpenRouter to another model provider
- **THEN** domain contracts, use cases, and HTTP controllers SHALL remain unchanged
- **AND** application use cases SHALL NOT depend directly on provider-specific SDK types
- **AND** all AI interactions SHALL pass exclusively through `AIProviderPort`

#### Scenario: Deterministic testing with fake provider
- **GIVEN** unit, integration, or CI test suites executing AI-related flows
- **WHEN** the test environment executes
- **THEN** the system SHALL use `FakeAIProvider` rather than live network calls
- **AND** SHALL NOT consume paid tokens, leak secrets, or depend on external service availability

### Requirement: Authorized project summary
The assistant SHALL generate structured project summaries, risk assessments, and next-step planning recommendations on demand for users with verified project authorization. The analysis SHALL compile only the minimum authorized project data using deterministic selection and bounded length, and SHALL label every response with an unconditional server-injected non-binding assistance notice.

#### Scenario: Request summary
- **WHEN** an authorized user requests a summary for a project
- **THEN** the system SHALL send only the minimum relevant authorized data to the configured provider
- **AND** SHALL label the result as AI-generated assistance

#### Scenario: Structured on-demand analysis for authorized project members
- **GIVEN** an authenticated user with active membership in project P or an assigned teacher for project P
- **WHEN** the user requests a structured AI analysis via `POST /api/projects/:projectId/ai/analysis`
- **THEN** the system SHALL return HTTP 200 containing structured sections for progress summary, risk signals, and recommended next steps
- **AND** the payload SHALL include the model identifier, response timestamp, and an unconditional server-injected disclaimer
- **AND** the analysis SHALL be delivered as a discrete on-demand response without continuous conversational chat

#### Scenario: Reject unauthorized access to project AI analysis
- **GIVEN** an unauthenticated request or a caller without active membership or teacher assignment in project P
- **WHEN** the caller attempts to request AI analysis for project P
- **THEN** the system SHALL reject the request with HTTP 401 or HTTP 403 before compiling data or contacting the AI provider
- **AND** SHALL NOT invoke `AIProviderPort` or disclose project progress data

#### Scenario: Sanitize, prioritize and bound transmitted context
- **GIVEN** an authorized request for project P
- **WHEN** the system prepares the prompt context for `AIProviderPort`
- **THEN** it SHALL extract only project title, board columns, task summaries, and high-level review status
- **AND** it SHALL bound task selection to at most 50 tasks, prioritizing active, blocked, high-priority, and near-deadline tasks
- **AND** it SHALL exclude tasks completed more than 7 days prior to the analysis request
- **AND** it SHALL apply deterministic truncation ensuring the prompt body does not exceed 10,000 characters and approximately 2,500 input tokens
- **AND** it SHALL NOT transmit passwords, session tokens, cookies, external evidence credentials, email addresses of uninvolved parties, or data from other projects

#### Scenario: Deliver structured sections and server-injected non-binding label
- **GIVEN** a successful response from `AIProviderPort`
- **WHEN** the application formats the result for the client
- **THEN** the server SHALL validate the structure against internal schema and inject the non-binding academic disclaimer directly from server configuration
- **AND** the disclaimer SHALL NOT depend on model compliance or model output fields
- **AND** the response SHALL prominently display that the content is an advisory suggestion and does not constitute an official academic evaluation

### Requirement: AI safety and cost limits
The system SHALL enforce persistent multi-instance usage quotas, concurrency guards, strict timeouts, bounded prompt/completion token limits, and controlled error handling. Failures, timeouts, or rate limits from the AI provider SHALL degrade cleanly without compromising non-AI system capabilities.

#### Scenario: Provider unavailable
- **WHEN** the provider times out, returns a rate limit, or fails
- **THEN** the system SHALL return a controlled error or a clearly marked fallback
- **AND** SHALL preserve access to non-AI project functions

#### Scenario: Enforce concurrency guard per user and project
- **GIVEN** an in-flight analysis request currently being processed for user U and project P
- **WHEN** a second analysis request arrives for the same user U and project P before the first completes
- **THEN** the system SHALL reject the subsequent request with HTTP 429 Too Many Requests
- **AND** the response SHALL contain a structured error message indicating that an analysis is already in progress
- **AND** the concurrency check SHALL be enforced across multiple server instances using persistent state

#### Scenario: Enforce sliding window quota per project
- **GIVEN** project P has completed or initiated 5 analysis requests within the last 10 minutes
- **WHEN** any authorized user submits another analysis request for project P within that same 10-minute window
- **THEN** the system SHALL reject the request with HTTP 429 Too Many Requests
- **AND** the response SHALL specify that the project quota of 5 requests per 10 minutes has been reached
- **AND** the quota evaluation SHALL be evaluated atomically against persistent state shared across instances

#### Scenario: Controlled response on provider timeout
- **GIVEN** an authorized request to `AIProviderPort`
- **WHEN** the provider does not respond within the configured timeout threshold of 8 seconds
- **THEN** the system SHALL abort the request via `AbortSignal`
- **AND** SHALL respond to the client with HTTP 504 Gateway Timeout or sanitized HTTP 503 error
- **AND** SHALL release the in-flight concurrency lock in persistent storage
- **AND** SHALL NOT enter an unbounded retry loop

#### Scenario: Controlled response on provider rate limit or quota exhaustion
- **GIVEN** an upstream provider response with HTTP 429 (Too Many Requests) or HTTP 402 (Payment Required)
- **WHEN** the adapter handles the provider failure
- **THEN** the system SHALL return a sanitized HTTP 429 or HTTP 503 response stating that AI assistance is temporarily unavailable
- **AND** SHALL NOT expose internal API keys, error traces, or raw provider bodies to the client

#### Scenario: Controlled response on malformed or invalid model payload
- **GIVEN** a 200 OK response from `AIProviderPort` containing invalid JSON, corrupted formatting, or missing required sections
- **WHEN** the server validates the raw completion against the internal payload schema
- **THEN** the system SHALL raise `AIInvalidResponseError` and return HTTP 502 Bad Gateway
- **AND** the response body SHALL contain a safe, sanitized message indicating that the AI response could not be processed
- **AND** SHALL NOT expose raw model output, prompt internals, or unhandled runtime exceptions

#### Scenario: Controlled response when provider is unconfigured or disabled
- **GIVEN** a deployment environment where `OPENROUTER_API_KEY` is not configured or AI assistance is disabled
- **WHEN** an authorized user requests project analysis
- **THEN** the system SHALL respond with HTTP 503 Service Unavailable indicating that AI assistance is not configured
- **AND** non-AI endpoints SHALL continue operating normally

#### Scenario: Preserve non-AI platform functionality during failures
- **GIVEN** complete unavailability or degradation of the AI provider
- **WHEN** users access boards, create or move tasks, submit reviews, or inspect project history
- **THEN** all core platform operations SHALL function without error or dependency on the AI provider

### Requirement: No automated grading
The assistant SHALL NOT issue official grades, approve or reject academic deliverables, or make binding academic evaluation decisions.

#### Scenario: User asks for a grade
- **WHEN** a user requests automated grading of a project
- **THEN** the assistant SHALL redirect to feedback/summarization support rather than produce an official grade

#### Scenario: Prompt redirect away from grading requests
- **GIVEN** an AI analysis prompt constructed for project P
- **WHEN** the system instructs the AI model via the system prompt
- **THEN** the instructions SHALL explicitly prohibit assigning numerical grades, qualitative letter grades, or passing/failing academic judgments
- **AND** SHALL instruct the model to redirect evaluative queries toward formative operational recommendations

#### Scenario: Disclaim evaluative and official grading validity
- **GIVEN** any delivered AI analysis output
- **WHEN** presented in the client application
- **THEN** the UI and API response SHALL explicitly display that the evaluation and grading of the project remains the sole exclusive authority of the course instructor
