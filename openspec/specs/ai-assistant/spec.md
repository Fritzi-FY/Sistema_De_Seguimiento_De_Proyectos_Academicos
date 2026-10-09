# AI Assistant

## Purpose
Provide optional AI-assisted summaries and planning suggestions through an interchangeable provider interface.

## Requirements

### Requirement: Provider abstraction
The system SHALL access AI capabilities through an internal `AIProvider` port with OpenRouter as the initial adapter.

#### Scenario: Provider replacement
- **WHEN** the configured provider changes
- **THEN** application use cases SHALL not need to depend directly on provider-specific SDK types

### Requirement: Authorized project summary
The assistant SHALL summarize only project data the requesting user is authorized to access.

#### Scenario: Request summary
- **WHEN** an authorized user requests a summary for a project
- **THEN** the system SHALL send only the minimum relevant authorized data to the configured provider
- **AND** SHALL label the result as AI-generated assistance

### Requirement: AI safety and cost limits
The system SHALL enforce configurable usage limits, timeouts, input/output limits, and controlled error handling.

#### Scenario: Provider unavailable
- **WHEN** the provider times out, returns a rate limit, or fails
- **THEN** the system SHALL return a controlled error or a clearly marked fallback
- **AND** SHALL preserve access to non-AI project functions

### Requirement: No automated grading
The assistant SHALL NOT issue official grades or make final academic decisions.

#### Scenario: User asks for a grade
- **WHEN** a user requests automated grading of a project
- **THEN** the assistant SHALL redirect to feedback/summarization support rather than produce an official grade
