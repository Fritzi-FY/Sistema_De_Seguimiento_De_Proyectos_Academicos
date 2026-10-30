## Purpose

Garantizar persistencia durable y recuperable de proyectos y membresías, manteniendo integridad transaccional, aislamiento de acceso e historial concurrente.

## ADDED Requirements

### Requirement: Durable project and membership storage
When durable storage is configured, the system SHALL retain committed projects and memberships across process restarts and application instances. Public request and response schemas SHALL remain compatible with projects-teams except for the explicitly planned removal changes below: required membershipId query parameter and nullable removedAt in membership responses. These changes SHALL be reflected in OpenAPI and affected consumers during implementation; canonical specifications SHALL NOT be edited during Level C.

#### Scenario: Restart and independent instance
- **GIVEN** an authorized owner creates a project and adds a collaborator successfully
- **WHEN** the application restarts and a separate instance reads the same database
- **THEN** authorized reads SHALL return the committed project and active memberships with the original identifiers and timestamps

### Requirement: Atomic project and owner persistence
The system SHALL persist a project and exactly one active owner membership matching its creator atomically in one database transaction: both or neither. A confirmed failure with confirmed rollback SHALL leave neither new record persisted. A lost COMMIT acknowledgement SHALL be treated as an uncertain outcome, not as proof of rollback. The creation port documentation SHALL distinguish these outcomes without changing its signature. The system SHALL NOT automatically retry an uncertain write.

#### Scenario: Owner insert fails
- **GIVEN** failure of the owner insert after the project insert and before commit
- **WHEN** the creation request fails
- **THEN** neither record SHALL remain committed and the API SHALL return its existing generic 500 response without database details

#### Scenario: Commit applied but acknowledgement lost
- **GIVEN** both inserts commit but the connection loses the COMMIT acknowledgement
- **WHEN** the application cannot confirm the outcome
- **THEN** the API SHALL return a generic 500 without database details and SHALL NOT retry the write automatically or claim that rollback was confirmed
- **AND** an authorized reconciliation from an independent connection using the generated identifiers SHALL find both records, never only one

#### Scenario: Disconnect aborts the transaction
- **GIVEN** both inserts execute but the connection is lost and the database aborts the transaction before commit
- **WHEN** an authorized reconciliation reads the generated identifiers after database availability is restored
- **THEN** neither record SHALL be present and the application SHALL NOT have retried the write automatically
- **AND** until reconciliation confirms the result, the application SHALL classify an unacknowledged outcome as uncertain

### Requirement: Concurrent membership integrity and history
The system SHALL allow at most one active membership for each project/user pair, retain removed records unchanged on re-addition, and reject memberships referencing nonexistent projects.

#### Scenario: Concurrent additions
- **GIVEN** an owner submits two concurrent additions for the same user and project
- **WHEN** both requests complete successfully at the transport level
- **THEN** exactly one SHALL return 201 and the other SHALL return 409, with exactly one active membership stored

#### Scenario: Remove and re-add
- **GIVEN** a collaborator has been removed
- **WHEN** the owner adds that user again
- **THEN** a new active record SHALL be created and the removed record SHALL retain its identifier and historical timestamps

#### Scenario: Missing parent
- **GIVEN** a nonexistent project identifier
- **WHEN** a membership insertion is attempted
- **THEN** no orphan membership SHALL be committed and the public request SHALL retain its existing 404 behavior

### Requirement: Single-source removal timestamp
Memberships SHALL have nullable removedAt, which SHALL be null while active. The removal use case SHALL obtain removedAt exactly once from its injected clock and pass it to the repository. The repository SHALL persist and return that exact value, set updatedAt to the same value, and SHALL NOT generate a separate removal timestamp. The use case SHALL return the persisted membership. This explicitly requires a minimal change to the removal port/use case and membership schemas; all other use cases SHALL remain independent of persistence technology.

#### Scenario: Clock advances during persistence
- **GIVEN** an active collaborator membership and an injected clock returning T1 on its first call and T2 on any later call, where T2 differs from T1
- **WHEN** an authorized removal executes and time advances during repository persistence
- **THEN** the use case SHALL call its clock once, and the repository input, committed removedAt and response removedAt SHALL all equal T1
- **AND** committed and returned updatedAt SHALL equal T1, while id and joinedAt SHALL remain unchanged

#### Scenario: Active and historical membership timestamps
- **GIVEN** a collaborator membership removed at T1
- **WHEN** the user is added again with a new membership identifier
- **THEN** the new active membership SHALL have removedAt null
- **AND** the old removed record SHALL retain removedAt and updatedAt equal to T1

### Requirement: Conditional removal of a specific membership
DELETE /api/projects/:projectId/members/:userId SHALL require a UUID membershipId query parameter identifying the membership the client intends to remove. The repository removal contract SHALL receive membershipId, projectId, userId and removedAt, and SHALL return the persisted removed membership or MembershipNotFoundError when no matching active membership exists. The system SHALL update only that active collaborator record conditionally by its identifier, project and user. Zero updated rows SHALL produce a generic 404, including after a successful precheck. Removed records SHALL NOT be rewritten. Existing creator-only authorization and owner protection SHALL be preserved.

#### Scenario: Missing or invalid membership identifier
- **GIVEN** an authenticated creator submitting a removal request with no membershipId or a non-UUID membershipId
- **WHEN** the HTTP input is validated
- **THEN** the API SHALL return 400 and SHALL NOT mutate any membership

#### Scenario: Successful conditional removal
- **GIVEN** an authenticated creator and the membershipId of an active collaborator matching the requested project and user
- **WHEN** DELETE executes successfully
- **THEN** the API SHALL return 200 with the persisted membership, status removed and the use-case-generated removedAt
- **AND** the response SHALL retain the existing membership fields, with updatedAt equal to removedAt

#### Scenario: Concurrent removals
- **GIVEN** two authorized requests targeting the same active membershipId and no infrastructure failure
- **WHEN** both attempt the conditional removal concurrently
- **THEN** exactly one SHALL return 200 and the other SHALL return 404
- **AND** the historical record SHALL retain the winning request's removedAt and updatedAt without a second mutation

#### Scenario: Delayed request after re-addition
- **GIVEN** membership M1 has been removed and the same user has rejoined through a new active membership M2
- **WHEN** an authorized removal request carrying M1's identifier arrives after M2 exists
- **THEN** the API SHALL return 404 and SHALL leave M2 active and both records' timestamps unchanged

#### Scenario: In-flight request resumes after re-addition
- **GIVEN** request A has observed active membership M1, request B removes M1, and the user rejoins with membership M2
- **WHEN** request A resumes its conditional update targeting M1
- **THEN** it SHALL update zero rows and return 404 without removing M2 or rewriting M1

#### Scenario: Identifier belongs to a different project or user
- **GIVEN** an authenticated creator requesting removal with a membershipId that does not match the requested project and user
- **WHEN** the system resolves or conditionally updates that membership
- **THEN** the API SHALL return a generic 404 and SHALL NOT mutate or disclose the mismatched membership

#### Scenario: Owner removal remains prohibited
- **GIVEN** the creator requests removal of their own active owner membership with its valid membershipId
- **WHEN** the removal is evaluated
- **THEN** the API SHALL return 422 and the owner record SHALL remain active with removedAt null

### Requirement: Immediate visibility of authorized mutations
The system SHALL return the latest committed membership state on subsequent authorized reads, without stale query-cache results. Removal SHALL revoke access granted by that membership for users with no other access permission; it SHALL NOT redefine independent teacher or administrative permissions. SEC-01 remains a priority risk blocking real-data exposure and deployment until the independent teacher-scope change is verified.

#### Scenario: Revoked access
- **GIVEN** an owner has successfully removed a collaborator who is not the creator and has no other permission to access the project
- **WHEN** that collaborator subsequently requests the project or its member list
- **THEN** the API SHALL return 404 and SHALL NOT disclose project or member data

#### Scenario: Added member reads immediately
- **GIVEN** a successful collaborator addition
- **WHEN** that user immediately lists projects or reads project details
- **THEN** the committed membership SHALL be reflected in the result

### Requirement: Safe database failures and authorization preservation
The system SHALL preserve existing owner/collaborator permissions and input validation with durable storage, SHALL NOT fall back to volatile storage on database failure, and SHALL NOT disclose credentials or SQL diagnostics.

#### Scenario: Unauthorized and invalid writes
- **GIVEN** no authenticated context, a non-owner requester, or an invalid creation payload
- **WHEN** the corresponding protected write is submitted
- **THEN** the API SHALL retain the existing 401, 403, or 400 behavior respectively and SHALL NOT commit a mutation

#### Scenario: Database unavailable
- **GIVEN** durable storage is selected and the database connection fails
- **WHEN** a persistence operation is attempted
- **THEN** the operation SHALL fail with a sanitized error and SHALL NOT acknowledge a write into an alternative in-memory store

### Requirement: Reproducible and recoverable schema evolution
Schema changes SHALL use ordered versioned migrations, preserve committed data on compatible application rollback, and prevent conflicting concurrent migration execution. Database operations SHALL have finite documented connection, statement and lock timeouts.

#### Scenario: Empty and existing test databases
- **GIVEN** an empty database or the preceding supported schema with synthetic records
- **WHEN** migrations execute and are subsequently invoked again
- **THEN** the target schema SHALL be reached once without duplicate application or loss of committed records

#### Scenario: Failed migration or lock timeout
- **GIVEN** a transactional migration fails or cannot acquire its migration lock within the configured timeout
- **WHEN** the migration runner exits
- **THEN** that migration SHALL NOT be marked successful and its partial transactional changes SHALL NOT remain

#### Scenario: Compatible application rollback
- **GIVEN** a committed dataset on the additive schema and a previously verified compatible PostgreSQL application revision
- **WHEN** operators restore that revision in an isolated recovery rehearsal
- **THEN** the dataset SHALL remain readable without destructive schema reversal or substitution by volatile storage

### Requirement: Independently authorized remote persistence spike
The remote Workers/Hyperdrive/Neon combination SHALL remain a candidate pending empirical evidence and human acceptance; confirmed architectural choices SHALL retain their existing status. The spike SHALL reuse the recorded local evidence without rerunning the local spike. Level C SHALL authorize only proposal, design, tasks and delta specification updates and validation. Separate explicit Level D SHALL be required for experimental code/configuration/tests; resource creation, secrets, remote migrations and database operations SHALL require an explicit scoped resource authorization, and publishing or deploying the experimental Worker SHALL additionally require specific Level E. None of these approvals SHALL imply application deployment, Git operations, dependency installation or paid upgrades.

#### Scenario: Plan approval without execution authorization
- **GIVEN** Level C approval for the remote spike and previously completed local tests
- **WHEN** the planning artifacts are updated and validated
- **THEN** no code, canonical specifications, Git state or cloud resources SHALL be modified by that approval
- **AND** remote execution SHALL remain pending independent authorizations

### Requirement: Authenticated synthetic remote experiment
The experimental Worker SHALL expose only bounded fixed probes over HTTPS, protected by a dedicated secret bearer token, and SHALL reject missing or invalid credentials with 401 before connecting to PostgreSQL. It SHALL use only synthetic data in an explicitly approved isolated database with destination guards. It SHALL NOT expose application routes, arbitrary SQL, development identity headers as authentication, real student data or production credentials. Runtime credentials SHALL be stored in protected Hyperdrive configuration, migrator credentials SHALL remain outside the Worker, and secrets SHALL NOT appear in source control, visible command arguments, responses, logs or evidence.

#### Scenario: Missing or invalid probe authentication
- **GIVEN** the remote experimental Worker is available
- **WHEN** a request has no bearer token or an invalid token
- **THEN** the Worker SHALL return 401 without database connection, mutation or diagnostic disclosure

#### Scenario: Unexpected destination or unsafe dataset
- **GIVEN** an endpoint, database or role outside the approved experiment, or a dataset containing real academic data
- **WHEN** preparation or execution checks detect it
- **THEN** the spike SHALL stop without accessing or mutating that destination or importing those data

### Requirement: Verified remote TLS and least privilege
Both the direct migrator/observer path and Hyperdrive origin path SHALL use verified TLS. Hyperdrive SHALL use verify-full with the appropriate trusted CA and matching origin hostname; insecure or unverified fallback SHALL be prohibited. The spike SHALL record sanitized configuration, actual server version and backend encryption evidence. The remote destination SHALL be neondb/is488_spike with schema ownership retained by neondb_owner. The separate is488_spike_migrator SHALL use USAGE/CREATE on that schema and own the objects it creates without requiring schema ownership or global administrative privileges; it SHALL NOT run through HTTP requests. The is488_spike_runtime role SHALL have only required CONNECT/USAGE and SELECT/INSERT/UPDATE on experimental data tables, without DDL, DELETE or administrative privileges. Runtime SHALL have no ledger access or control through direct or column ACLs, PUBLIC, inherited privileges or assumable roles.

#### Scenario: Invalid TLS trust configuration
- **GIVEN** an isolated negative probe with an invalid trust configuration
- **WHEN** a connection to the experimental origin is attempted
- **THEN** it SHALL fail certificate verification without falling back to weaker TLS or changing shared resources

#### Scenario: Runtime attempts a forbidden operation
- **GIVEN** the runtime role used by the Worker
- **WHEN** the experiment attempts DDL or migration ledger modification
- **THEN** PostgreSQL SHALL deny the operation without granting additional privileges

### Requirement: Remote transaction pooling and fresh reads
The spike SHALL demonstrate parameterized pg/Drizzle queries and single-connection transaction commit/rollback from a real Worker through a cache-disabled Hyperdrive binding to the direct Neon PostgreSQL endpoint. It SHALL apply a separately reviewed remote variant of the local generated migration through the verified direct path, changing schema references from spike to is488_spike while retaining experimental tables, constraints and indexes. The remote variant SHALL have its own migration identity/checksum and provenance; local SQL, code and evidence SHALL remain unchanged. The remote runner SHALL verify the existing schema and SHALL NOT create a database/schema, change schema ownership, modify public privileges or general default privileges. It SHALL verify ledger/checksum and non-reapplication. It SHALL test concurrency and immediate visibility through separate Worker invocations and independent direct observations; Node-only success SHALL NOT substitute for Worker evidence. HTTP private/no-store SHALL accompany query-cache disabling and SHALL NOT be treated as a substitute for it.

#### Scenario: Default table privileges would expose the ledger
- **GIVEN** migrator default privileges would grant runtime INSERT/SELECT/UPDATE on future is488_spike tables, including a new ledger
- **WHEN** the independently authorized remote migration creates its ledger
- **THEN** the runner SHALL neutralize runtime and PUBLIC ledger privileges within the same transaction before commit and verify effective denial including column ACLs, inheritance and assumable roles
- **AND** if effective isolation requires changes outside the approved ledger scope, it SHALL roll back and request review rather than broaden revocations
- **AND** mandatory post-migration verification from an actual runtime session SHALL confirm denied ledger reads/writes, absence of other ledger privileges or ownership/control, and permitted operations only on experimental data tables
- **AND** any failed or missing post-migration verification SHALL block R2 acceptance without automatic destructive cleanup

#### Scenario: Unexpected remote migration state
- **GIVEN** a destination other than the approved endpoint/neondb/is488_spike/role, unexpected existing objects or a conflicting checksum
- **WHEN** the remote runner checks its preconditions
- **THEN** it SHALL stop without overwriting objects, changing ownership or modifying public privileges

#### Scenario: Commit and second-insert rollback through Hyperdrive
- **GIVEN** an authenticated probe writing a synthetic project and owner on one transaction connection
- **WHEN** one invocation commits and a separate trial fails the second insert with a real constraint violation and confirmed rollback
- **THEN** independent direct and Worker reads SHALL find both committed records in the first trial and neither in the second, never a partial pair

#### Scenario: Concurrent remote membership mutations
- **GIVEN** two authenticated concurrent Worker invocations targeting the same synthetic membership pair
- **WHEN** both attempt additions and later two invocations attempt conditional removal of the resulting membership
- **THEN** additions SHALL yield one insert and one active-uniqueness conflict, and removals SHALL affect one row and zero rows respectively
- **AND** re-addition SHALL preserve history and a removal with the previous identifier SHALL leave the new membership intact
- **AND** SQL probe outcomes SHALL NOT be represented as verified application HTTP authorization or contract behavior

#### Scenario: Read previously queried state after a remote write
- **GIVEN** a SELECT was executed before an addition or removal and Hyperdrive caching is disabled
- **WHEN** the write commits and a separate Worker invocation immediately reads via Hyperdrive
- **THEN** it SHALL observe the latest committed state with private/no-store HTTP responses

### Requirement: Separate remote binding and certificate identifiers
The remote runner and authenticated Worker SHALL have separate configurations and duties. The Worker SHALL use the HYPERDRIVE binding associated with the independently identified configuration ID of is488-neon-spike; the uploaded CA certificate ID SHALL be identified separately and SHALL NOT be substituted for the Hyperdrive configuration ID. Missing identifiers or credentials SHALL remain explicit blockers and SHALL NOT be invented. Panel configuration and user-provided audit evidence SHALL be distinguished from executed Worker connectivity tests.

#### Scenario: Binding identifier is not confirmed
- **GIVEN** only the Hyperdrive name or the CA certificate ID is known
- **WHEN** remote Worker preparation requires a Hyperdrive configuration ID
- **THEN** preparation SHALL remain blocked on that identifier without guessing it or substituting the certificate ID

#### Scenario: Hyperdrive and runtime limits are both five
- **GIVEN** Hyperdrive origin limit 5 and runtime role connection limit 5, with max_connections 901 applying globally rather than per role
- **WHEN** remote testing begins
- **THEN** probes SHALL start sequentially with one client per request, and direct runtime observers SHALL NOT overlap Hyperdrive activity
- **AND** two concurrent probes SHALL be attempted only after checking current session capacity and abandoned transactions, without treating low request concurrency as guaranteed connection headroom
- **AND** connection saturation SHALL stop the affected test and leave it pending without automatic limit increases, pool restarts or session termination

### Requirement: Finite remote timeouts and honest failure evidence
The spike SHALL verify client connection timeout 5 seconds, statement timeout 5 seconds, lock timeout 2 seconds and a total transaction timeout of 10 seconds, with effective values and elapsed times recorded. Statement/lock settings SHALL apply per query or transaction and be verified after pool reuse. An incompatible timeout mechanism SHALL trigger review rather than an unapproved substitute. Clients SHALL close on success and failure, without sustained connection growth or abandoned transactions; idle Hyperdrive origin connections SHALL NOT be classified as client leaks. Controlled disconnections SHALL affect only explicitly authorized synthetic sessions, with independent reconciliation and no automatic retry of uncertain writes or fallback to memory.

#### Scenario: Timeout after pool reuse
- **GIVEN** a reused pooled connection and a deliberately slow statement or blocked lock
- **WHEN** the authenticated probe executes it with the approved timeouts
- **THEN** effective settings, elapsed time and the expected 57014 or 55P03 error SHALL be recorded without leaking SQL or secrets to the client
- **AND** a multi-statement transaction SHALL separately demonstrate its total finite deadline
- **AND** five consecutive failed probes SHALL leave no abandoned transactions or sustained client connection growth

#### Scenario: Remote commit acknowledgement cannot be observed
- **GIVEN** a controlled transport fault whose exact relation to PostgreSQL COMMIT cannot be established
- **WHEN** the spike reconciles the generated identifiers
- **THEN** it SHALL record both or neither and SHALL NOT retry or claim confirmed rollback without evidence
- **AND** HTTP cancellation or local TCP proxy evidence SHALL NOT be claimed as proof of remote SQL acknowledgement loss
- **AND** an unproven required remote scenario SHALL remain pending and block complete remote acceptance

### Requirement: Zero-cost bounded remote acceptance
The remote spike SHALL have a maximum new-service budget of US$0, use only verified available free quotas and SHALL NOT enable paid plans, billing upgrades or paid auxiliary services. The runner SHALL enforce at most 95 plan requests and 2000 total reserved statements, start sequentially and allow concurrency up to 2 only after connection-capacity checks; it SHALL stop earlier if available shared quotas or role capacity are insufficient. Hyperdrive 5/runtime 5 SHALL NOT be considered guaranteed headroom and limits SHALL NOT be increased automatically. The report SHALL record plans, region, exact versions, cold/warm latency, observed suspension behavior, connection usage, quotas before/after, sanitized commands/results and every failed or pending scenario. Full acceptance SHALL require design R1–R7 evidence and a separate human decision; it SHALL NOT certify application security, provider recovery, RPO/RTO or production readiness.

#### Scenario: Insufficient free quota or paid feature requirement
- **GIVEN** preparation or execution reveals an exhausted quota, a paid-only prerequisite or an experiment limit reached
- **WHEN** continuing would exceed the approved free resources or bounds
- **THEN** execution SHALL stop without upgrading, spending or substituting a provider automatically

#### Scenario: Complete or partial remote report
- **GIVEN** remote checks have produced observed results
- **WHEN** the acceptance report is presented
- **THEN** every required R1–R7 check SHALL be traced to actual evidence or explicitly marked failed/pending
- **AND** any failed or pending required check SHALL prevent complete remote acceptance and definitive candidate adoption
- **AND** access closure and token rotation SHALL follow the scoped authorization, without automatic deletion of retained data or cloud resources

### Requirement: H1.1 Pre-dispatch correlation and durable evidence
The experimental caller SHALL choose operationId and resource identifiers before dispatch. operationId SHALL mean correlation only, without durable deduplication or an exactly-once guarantee. The harness SHALL validate and preserve a versioned local manifest and a manifest-linked dispatch journal under %LOCALAPPDATA%\IS488\probe-evidence\ in an exclusively created runId directory outside Git, with verified Windows DACL restricted to operator SID and SYSTEM, confinement and no reparse points. manifest.json, manifest.sha256 and journal.jsonl SHALL be completely written, synchronized, closed and read back before dispatch. Confirmed persistence and integrity SHALL precede dispatch. Evidence SHALL contain only allowed synthetic identifiers, expectations, dependencies and budgets, never credentials or raw HTTP messages. This requirement SHALL NOT change the migration, its checksum, privileges or migration ledger.

#### Scenario: Manifest cannot be safely preserved
- **GIVEN** manifest creation, flush, close, integrity verification or destination protection fails or cannot be confirmed
- **WHEN** the harness prepares the plan
- **THEN** it SHALL send no request and SHALL preserve existing evidence without overwrite or automatic cleanup

#### Scenario: Process stops around dispatch
- **GIVEN** a durable dispatch intention and reservation exist for an operation
- **WHEN** the process stops before a result is durably recorded
- **THEN** recovery SHALL classify dispatch as possibly performed and SHALL NOT automatically resume or retry the write
- **AND** the manifest SHALL retain the identifiers and expected synthetic attributes needed for authorized reconciliation

#### Scenario: Duplicate identifiers in a plan
- **GIVEN** repeated operationId values or resource creation IDs assigned to distinct creations
- **WHEN** the complete plan is validated before dispatch
- **THEN** the harness SHALL reject it without traffic; an existing database PK conflict SHALL NOT be converted into idempotent success


#### Scenario: Evidence recovery is incomplete or untrusted
- **GIVEN** a truncated journal, broken hash chain, incomplete manifest, unexpected ACL, reparse point or unconfirmed persistence
- **WHEN** preparation or read-only recovery checks the evidence
- **THEN** it SHALL block dispatch and automatic recovery, preserve all files and retain uncertain reservations
- **AND** uncertain evidence SHALL remain until human review, without automatic truncation, repair, expiration or deletion

### Requirement: H1.2 Explicit transaction and close outcomes
The experimental Worker SHALL track attempts and confirmations of BEGIN, COMMIT, ROLLBACK and close independently. Validated correlation SHALL remain available on all subsequent outcomes. It SHALL NOT infer rollback from an absent BEGIN acknowledgement, retry an uncertain write, or issue ROLLBACK after an unacknowledged COMMIT. A confirmed COMMIT SHALL remain committed despite later close or transport failure. Experimental envelopes SHALL distinguish transaction outcome from connection close and SHALL NOT redefine product API contracts.

#### Scenario: Begin or rollback acknowledgement is absent
- **GIVEN** BEGIN or ROLLBACK was attempted without a confirmed response
- **WHEN** the Worker reports the failure
- **THEN** it SHALL report an unconfirmed transaction outcome, never confirmed rollback
- **AND** a failure before BEGIN was attempted SHALL instead be distinguishable as not_started

#### Scenario: Commit acknowledgement is lost
- **GIVEN** COMMIT was attempted and no confirmation is available
- **WHEN** the Worker can return a response
- **THEN** it SHALL return sanitized HTTP 500 with unknown outcome and the validated correlation identifiers, without retry or subsequent ROLLBACK
- **AND** complete HTTP loss SHALL still leave those identifiers in the caller's pre-dispatch manifest

#### Scenario: Confirmed commit followed by failed close
- **GIVEN** COMMIT is confirmed and close fails or remains unconfirmed
- **WHEN** the experimental Worker can return its response
- **THEN** it SHALL return HTTP 200 with outcome committed, close unconfirmed and the validated identifiers
- **AND** the harness SHALL retain the transaction result, stop new writes and reject acceptance of that scenario

#### Scenario: Confirmed rollback or conflict followed by failed close
- **GIVEN** a rollback or expected active-pair conflict was confirmed before close failed
- **WHEN** the Worker forms its final envelope
- **THEN** it SHALL retain the confirmed transaction information and separately report unconfirmed close
- **AND** neither a late client error nor close failure SHALL replace the envelope with a result that loses those facts

### Requirement: H1.3 Coherent observation with limited attribution
Reconciliation SHALL use validated parameters and one SQL statement with a coherent snapshot for exact identifiers and expected synthetic relationships/attributes. For project-owner creation it SHALL classify BOTH, NEITHER, PARTIAL, MISMATCH or UNVERIFIED. Observation SHALL be separated from causal attribution. Single-membership addition/removal SHALL use operation-specific observations rather than pretending to be a two-record pair. Reconciliation SHALL NOT introduce arbitrary SQL, automatic retries, an operation ledger or disclosure of incompatible row contents.

#### Scenario: Pair exists but does not match expectations
- **GIVEN** the requested IDs identify rows with an unexpected relationship or synthetic attribute
- **WHEN** reconciliation observes them in one snapshot
- **THEN** it SHALL report MISMATCH rather than BOTH, stop the affected experiment and preserve sanitized evidence without overwriting data

#### Scenario: Partial pair or unsuccessful read
- **GIVEN** reconciliation sees exactly one record or cannot complete a valid observation
- **WHEN** it classifies the result
- **THEN** it SHALL respectively report PARTIAL or UNVERIFIED, never successful atomicity or NEITHER

#### Scenario: Neither is visible while work may continue
- **GIVEN** neither record is visible but the original operation may still be executing
- **WHEN** reconciliation returns NEITHER
- **THEN** it SHALL describe only the observed snapshot and SHALL NOT claim terminal absence, confirmed rollback or permission to retry

#### Scenario: Concurrent removals lose their HTTP responses
- **GIVEN** two operations target the same membership and their HTTP outcomes are lost
- **WHEN** reconciliation observes that membership removed
- **THEN** it SHALL NOT attribute affected=1 or the winning removal to either operationId from that state alone
- **AND** any scenario requiring that attribution SHALL remain pending unless independent evidence establishes it

### Requirement: H2.1 Strict separate experimental contracts
The experimental protocol SHALL have explicit request/response schemas, route/method/version rules and finite input bounds, validated before database client creation. Authentication SHALL precede expensive parsing and DB access. Unknown, duplicate or invalid parameters SHALL be rejected rather than silently collapsed. Writes SHALL use strict flat JSON v1 objects as defined in design 5.5, with no query fallback, coercion or extra fields; product contracts SHALL remain unchanged. Input SHALL be limited incrementally to 4096 bytes and complete serialized URL to 2048 UTF-8 bytes. Duplicate keys, including equivalent Unicode escape spellings, SHALL be detected on decoded names using jsonc-parser 3.2.0 visit before JSON.parse and strict Zod validation; comments, trailing commas, invalid UTF-8/BOM, arrays and nested objects SHALL be rejected. Every parser error SHALL reject the input, never recover it as acceptable. Credentials SHALL travel only through the approved bearer mechanism, and the harness SHALL reject redirects.

#### Scenario: Malformed or ambiguous request
- **GIVEN** duplicate query/JSON keys, unknown fields, invalid IDs/version, excessive size or an unsupported input representation
- **WHEN** the experimental request is validated
- **THEN** it SHALL fail with the fixed status/code specified by the approved protocol before any database client is created
- **AND** legacy write requests SHALL NOT silently fall back to another transport


#### Scenario: Escaped duplicate keys and exact input bounds
- **GIVEN** equivalent decoded keys with different JSON escapes, or input at and above the 4096-byte body or 2048-byte URL bounds
- **WHEN** the strict experimental contract validates the request
- **THEN** duplicated keys and excessive inputs SHALL fail before any database client creation
- **AND** boundary-sized input SHALL still require valid syntax, route schema, authentication and compatible values

### Requirement: H2.2 Bounded sanitized partial evidence
The harness SHALL consume HTTP response streams incrementally with a maximum of 65536 received consumer bytes per response, independently of Content-Length. It SHALL validate the response contract and retain only an explicit allowed projection and fixed failure codes. Raw bodies, SQL, URLs containing credentials, bearer tokens and arbitrary server error messages SHALL NOT enter evidence. It SHALL preserve already confirmed partial results when transport, body parsing or evidence persistence fails and SHALL stop new dispatches.

#### Scenario: Oversized or invalid response
- **GIVEN** a response without reliable length, an oversized chunk, invalid JSON/schema or disallowed encoding
- **WHEN** the harness consumes it
- **THEN** it SHALL enforce the byte limit before accumulation, cancel further consumption within its deadline and retain only a fixed sanitized failure
- **AND** it SHALL NOT print or persist the rejected raw body even when it contains diagnostic fields

#### Scenario: Later response or evidence sink fails
- **GIVEN** earlier requests have confirmed recorded results
- **WHEN** a later response or evidence write fails or stalls
- **THEN** the harness SHALL preserve those results, classify the remaining uncertainty and stop new requests without automatic cleanup or retry

### Requirement: H2.3 End-to-end finite deadlines without cancellation claims
The approved protocol SHALL define monotonic deadlines for transport plus body, concurrent groups, evidence handling and the whole plan, compatible with Worker connection/transaction/close limits. Each read SHALL consume the remaining request deadline rather than restart it. A timeout SHALL bound the harness even if an injected transport or cancellation promise ignores abort. HTTP timeout or cancellation SHALL NOT be represented as proof of SQL cancellation, rollback or remote quiescence. HTTP SHALL have a 20-second integral deadline; Worker preparation SHALL be limited to 2 seconds, connect to 5, transaction to 10 from attempted BEGIN, each query to at most 6 within remaining transaction time, and close to 1. Global plan and evidence deadlines SHALL follow design 5.5 without automatic extension. These limits SHALL NOT assert a network SLA or interruptibility of synchronous CPU.

#### Scenario: Transport ignores abort or body never completes
- **GIVEN** an unresponsive transport, body reader, cancellation or evidence sink
- **WHEN** its deadline expires
- **THEN** the harness SHALL stop new dispatches within the approved bound, retain fixed failure/unknown information and avoid indefinite waits
- **AND** an already dispatched concurrent peer SHALL retain its original bounded collection deadline without starting another group

### Requirement: H2.4 Reserved shared budget and demonstrable concurrency
The harness SHALL default to sequential dispatch and permit at most two requests concurrently only after the approved capacity check. A single coordinator SHALL reserve the complete group and planned reconciliation before dispatch against shared request/statement budgets, including direct observations and failures. Reservations SHALL NOT be refunded after uncertain dispatch. The plan SHALL be limited to 95 total requests and 2000 reserved statements, US$0, including errors, reconciliation and direct observations; the former general ceiling of 100 invocations SHALL NOT authorize additional requests. At most two concurrent requests SHALL be allowed only in R4. Conservative charges SHALL be justified against actual maximum statements per route; insufficient reserve SHALL reduce or stop the plan. Evidence SHALL distinguish simultaneous client requests from observed overlapping database work.

#### Scenario: Expected active-pair conflict
- **GIVEN** R4 plans two additions and both requests complete under the expected conditions
- **WHEN** the harness evaluates their responses
- **THEN** it SHALL accept one committed HTTP 200 and one HTTP 409 only with ACTIVE_PAIR_CONFLICT, confirmed rollback and confirmed closes, plus independent evidence of one active membership
- **AND** unexpected 409 codes, missing fields or unconfirmed close SHALL fail that assertion

#### Scenario: Insufficient budget or partial concurrent failure
- **GIVEN** the complete group cannot be reserved or a dispatched member fails unexpectedly
- **WHEN** the coordinator evaluates the group
- **THEN** it SHALL respectively dispatch none or stop subsequent groups while collecting the already dispatched peer within its deadline
- **AND** uncertain reservations SHALL remain charged and SHALL NOT trigger a retry or automatic limit increase

#### Scenario: Only HTTP concurrency is demonstrated
- **GIVEN** two requests were in flight but database overlap is not independently established
- **WHEN** R4 evidence is reported
- **THEN** the report SHALL state HTTP concurrency only and SHALL leave required database-overlap evidence pending

### Requirement: H2.5 Reproducible validation and honest R1-R7 acceptance
H1/H2 SHALL be traced from requirements through implementation and specific tests to evidence classified as simulated, local real or remote, distinguishing user-provided results from agent execution. Experimental dependencies SHALL use the exact versions and dedicated remote package/lock proposed in design 5.6, including proposed direct devDependency @types/node 24.19.0 with runtime Node 24.18.0, subject to independent dependency authorization; C-DEP-01 SHALL be considered closed at specification level only. Types 26.6.5 SHALL NOT establish spike compatibility. Dependency resolution/integrity, typecheck, specific tests on Node 24.18.0 and offline Workers bundle SHALL remain mandatory before accepting D1; APIs introduced only after the chosen runtime SHALL NOT be used; incidental workspace hoisting SHALL NOT establish reproducibility. The Worker bundle SHALL be verifiable offline with recorded installed versions/inputs, without runner-only credential/filesystem code, installations or cloud publication. R1-R7 assertions SHALL follow design 5.6 and SHALL NOT infer full acceptance from HTTP statuses alone or from root workspace checks.

#### Scenario: Local validation succeeds without remote evidence
- **GIVEN** simulated tests, isolated PostgreSQL tests or an offline bundle succeed
- **WHEN** the result is reported
- **THEN** only their demonstrated boundaries SHALL be accepted and unexecuted Worker/Hyperdrive scenarios SHALL remain pending
- **AND** a missing required remote observation, unknown required attribution or failed close SHALL block complete remote acceptance

#### Scenario: Planning finished but implementation is not authorized
- **GIVEN** governance and H1/H2 planning edits have been validated
- **WHEN** the current phase ends
- **THEN** the agent SHALL stop before code, evidence-file creation, SQL or cloud operations and request independent D with concrete files and resolved contract/dependency decisions
- **AND** local integration, remote migration, deployment and resource operations SHALL retain their separate scoped authorizations

### Requirement: Incremento local mantiene composición y contratos de retiro

El producto SHALL permitir selección explícita memory/postgres, con memory predeterminado y los tres puertos SQL compuestos conjuntamente sin fallback. Kanban SHALL conservar un storage volátil compartido por aplicación.

#### Scenario: Retiro obsoleto tras reincorporación

- **GIVEN** una membresía retirada y otra nueva activa para el mismo usuario/proyecto
- **WHEN** llega DELETE con membershipId anterior
- **THEN** responde 404 sin modificar la membresía nueva

#### Scenario: Timestamp único y respuesta confirmada

- **GIVEN** un colaborador activo identificado por membershipId, projectId y userId
- **WHEN** se retira por esa identidad completa
- **THEN** removedAt y updatedAt coinciden con el único timestamp de la operación y la respuesta proviene de la fila persistida

#### Scenario: COMMIT sin confirmación

- **GIVEN** ambas inserciones despachadas en una transacción
- **WHEN** COMMIT no recibe confirmación
- **THEN** se distingue resultado incierto de rollback confirmado sin éxito, retry ni compensación SQL

### Requirement: Migrador local ordenado y explícito
El producto SHALL ofrecer comandos manuales plan/apply/reconcile locales, sin SQL de arranque API. Usará migraciones consecutivas inmutables con SHA-256 y ledger privado; public será explícito y coherente con adaptadores y search_path pg_catalog,public.

#### Scenario: Primera aplicación y evolución
- **GIVEN** una base vacía exclusiva y credenciales migradoras separadas
- **WHEN** se aplican versiones consecutivas bajo sesión directa y lock exclusivo
- **THEN** cada DDL y fila de ledger se confirman juntos, datos previos se conservan y reejecutar no repite DDL

#### Scenario: Historial no aprobado
- **GIVEN** versión desconocida, hueco, checksum alterado o base existente sin ledger/baseline aprobado
- **WHEN** se solicita plan/apply/reconcile
- **THEN** se rechaza sin aplicar ni adoptar objetos

#### Scenario: Exclusión y fallo intermedio
- **GIVEN** dos primeras ejecuciones o fallo dentro de una versión
- **WHEN** compiten por el mismo lock con plazo acotado o falla DDL
- **THEN** solo una sesión modifica a la vez, timeout no despacha DDL y fallo confirmado no deja DDL ni fila parcial

### Requirement: Confirmación y reconciliación del migrador
El migrador SHALL preservar evidencia saneada antes de despachar, distinguir confirmación de incertidumbre y usar el mismo lock para aplicar y reconciliar.

#### Scenario: Respuesta COMMIT perdida
- **GIVEN** COMMIT despachado y respuesta perdida
- **WHEN** termina la espera acotada
- **THEN** se detiene el lote unknown sin retry ni rollback compensatorio, con cierre informado separado
- **AND** reconcile en nueva sesión bajo el mismo lock observa ledger/checksum/esquema sin reaplicar automáticamente ni atribuir causalidad

#### Scenario: Reconciliación ausente
- **GIVEN** un intento incierto y transacción anterior excluida mediante el mismo lock
- **WHEN** reconcile no encuentra la versión
- **THEN** registra observación ausente sin reapply y mantiene apply bloqueado hasta recuperación aprobada

#### Scenario: Privilegios separados
- **GIVEN** roles migrador/runtime no administrativos ni asumibles entre sí
- **WHEN** runtime opera en negocio o intenta DDL, DELETE o ledger
- **THEN** solo arw autorizado es posible y ledger/DDL/DELETE son denegados, considerando PUBLIC/defaults/herencia

### Requirement: R Product remote validation has separate authorizations
Remote validation SHALL reuse product adapters and migrator, not the WIP probe. Code preparation, dependency installation, account reads, resources (including origin connection), administrative SQL/ACL, migration, deployment, synthetic DML and cleanup SHALL retain independent scoped authorizations. US$0 SHALL depend on actual approved quotas. Endpoint exposure SHALL require implemented and verified teacher-project-scope-enforcement and remote authentication.

#### Scenario: Only planning is approved
- **GIVEN** C approves these artifacts and the independent SEC-01 policy
- **WHEN** formalization finishes
- **THEN** the agent SHALL stop before code, installation, SQL, resources, deployment or Git mutation and present exact D-P files/dependencies from design R.8

#### Scenario: Historical tests are not remote acceptance
- **GIVEN** local spike or product tests have passed
- **WHEN** product remote validation is prepared
- **THEN** evidence SHALL retain local/simulated boundaries without repeating historical experiments or marking R1–R7/H1/H2 complete

### Requirement: R Transaction-local settings under pooling
Every repository operation SHALL run with public-qualified business queries and bounded transaction-local search_path/timeouts under pooling. Existing explicit transactions SHALL reuse their context without nested BEGIN/COMMIT. Connection-only SET SHALL NOT establish later backend state. Confirmed rollback conflict mapping and uncertain outcomes SHALL be preserved.

#### Scenario: Pool resets and reassigns backends
- **GIVEN** a pool resets settings between transactions
- **WHEN** the product executes independent repository operations
- **THEN** each unit SHALL establish its own transaction-local limits before SQL without depending on a previous backend

#### Scenario: Lost commit response of autonomous write
- **GIVEN** COMMIT was dispatched without acknowledgement
- **WHEN** a deadline expires
- **THEN** outcome SHALL remain unknown, without retry or compensating ROLLBACK, and close SHALL be reported separately

### Requirement: R Injectable synthetic remote authentication
Remote product routes SHALL accept only verified identities from an injected authenticator. Access service tokens SHALL represent approved synthetic machine actors, not institutional academic authentication. Client roles and X-Dev headers SHALL NOT grant privileges remotely. Missing configuration/verification SHALL fail closed before SQL.

#### Scenario: Invalid token or client-selected identity
- **GIVEN** invalid signature, issuer, audience, expiry, unknown actor or attempted X-Dev override
- **WHEN** a protected remote route is requested
- **THEN** no SQL SHALL be dispatched and no client-selected identity or role SHALL become authorized

#### Scenario: Unapproved remote route or bypass
- **GIVEN** only authenticated health and enumerated project/membership methods are allowed
- **WHEN** another route or bypass hostname is requested
- **THEN** access SHALL be denied without database operations or development-auth fallback

### Requirement: R Opt-in direct TLS migration profile
The product migrator SHALL retain local guards and require a separately approved exact-target remote TLS profile with verified CA/hostname and no pooled endpoint. The same catalog/checksum/private ledger/session lock and per-version DDL-ledger transaction SHALL apply to plan/apply/reconcile. Effective privileges SHALL include ownership, database/schema/table/column ACLs, PUBLIC, defaults and assumable roles, including MAINTAIN where supported.

#### Scenario: Missing or mismatched remote target
- **GIVEN** local mode or an unapproved remote host, database, role, CA, version or server identity
- **WHEN** remote connection/migration is requested
- **THEN** it SHALL reject without relaxing local guards or bypassing TLS verification

#### Scenario: Unapproved managed baseline
- **GIVEN** provider objects do not match the approved empty-base inventory
- **WHEN** migration preflight inspects them
- **THEN** it SHALL stop for an explicit baseline decision without deleting provider objects or disabling the guard

#### Scenario: Extra runtime privileges
- **GIVEN** runtime can access ledger, assume privileged roles, own objects or perform non-allowlisted DDL/TEMP/MAINTAIN operations
- **WHEN** effective privilege checks run
- **THEN** acceptance SHALL fail without expanding privileges or hiding the discrepancy

#### Scenario: Uncertain migration reconciliation
- **GIVEN** COMMIT has no confirmation
- **WHEN** a new direct session reconciles under the same lock
- **THEN** it SHALL only observe ledger/checksum/fingerprint, and an absent version SHALL preserve the block without automatic reapplication

### Requirement: R Bounded isolated product acceptance
The future run SHALL use newly approved synthetic resources, identified A/B product deployments sharing one database and bundle hash, and disabled SQL cache. Shared limits SHALL be 95 requests, 1200 statements and 30 minutes including setup/failures/observations/cleanup. Reservations SHALL precede dispatch and uncertain attempts SHALL NOT refund budget. Missing Free quota or uncertain effects SHALL stop new mutations without automatic upgrade/retry.

#### Scenario: Conditional removal and immediate revocation
- **GIVEN** C has membership M1 on P1 without ownership or another authorization
- **WHEN** O removes M1 in A and removal is confirmed
- **THEN** B SHALL deny detail/membership reads with 404, omit P1 from C's list and retain removedAt equal to persisted updatedAt
- **AND** later membership M2 SHALL remain intact after an obsolete M1 removal request

#### Scenario: Teacher assignment does not grant mutation
- **GIVEN** SEC-01 is implemented and T has assignment but no creator/collaborator relationship
- **WHEN** T consults P1 or attempts member management
- **THEN** consultation SHALL follow assignment while mutations SHALL remain governed by their existing relationship-specific rules

#### Scenario: Persistence is not inferred from repeated requests
- **GIVEN** A created a project and exactly one matching owner atomically
- **WHEN** B and an independent direct session read the same database
- **THEN** original IDs/timestamps SHALL remain, without claiming in-memory Kanban durability or distinct isolates from repeated requests alone
## Local implementation evidence

Implementation and bounded local tests are recorded in evidence/epic-002-remote-preparation/20261026-dp-ds/README.md and evidence/teacher-project-scope/20261026-ds/README.md. No remote acceptance, institutional source integration, deployment or EPIC closure is asserted.


### Requirement: Explicit Neon proxy TLS observation
For the approved direct endpoint `ep-icy-meadow-b4zhj5uj.c-6.us-east-2.aws.neon.tech` and database `is488_epic002_validation` only, an explicit Neon proxy profile SHALL verify the live client TLS socket before any SQL: negotiated TLS 1.2/1.3, authorized certificate chain, no authorization error, a peer certificate and Node hostname verification against the exact endpoint. Strict CA/hostname configuration remains mandatory. The profile SHALL retain database/role/version/CA guards. `pg_stat_ssl` SHALL be recorded as a backend observation, without claiming it establishes client-to-proxy encryption or all provider-internal segments. Other remote profiles retain their backend TLS guard.

#### Scenario: Proxy backend reports no TLS with a verified external channel
- **GIVEN** the exact opt-in Neon profile and live authorized TLS evidence for that endpoint
- **WHEN** the backend identity query reports ssl=false
- **THEN** the backend observation SHALL be retained and SHALL NOT alone reject the verified external channel

#### Scenario: Missing TLS or invalid certificate or hostname
- **GIVEN** missing TLS, an unauthorized certificate chain, missing peer certificate or a mismatched hostname
- **WHEN** remote validation starts
- **THEN** it SHALL fail before SQL, without plaintext fallback or disabling certificate verification
