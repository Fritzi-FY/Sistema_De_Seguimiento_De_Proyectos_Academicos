## MODIFIED Requirements

### Requirement: Teacher scope
The system SHALL limit teacher review and project consultation to projects for which the authenticated teacher has an explicit assignment or an existing authorized creator/collaborator relationship. The teacher role alone SHALL NOT grant global project access. An explicit teacher assignment SHALL grant project consultation/review only and SHALL NOT imply member management or other mutations. Existing creator/collaborator permissions SHALL remain unchanged for a user who is also a teacher. Project lists SHALL be filtered on the server; unrelated project detail SHALL return 404 without revealing existence. Without an authorized relationship or a separately explicit existing administrative permission the system SHALL deny access. Client-supplied roles SHALL NOT grant privileges. Assignments SHALL be maintained by an authorized operator without self-assignment; the definitive institutional source SHALL remain pending until independently specified and approved.

#### Scenario: Teacher role without a relationship
- **GIVEN** an authenticated teacher has no assignment, ownership or active collaborator membership for project P
- **WHEN** the teacher requests project list or P detail
- **THEN** the list SHALL omit P and detail SHALL return 404 without disclosing existence or metadata
- **AND** the teacher role SHALL NOT trigger a global findAll access path

#### Scenario: Explicit assignment without membership
- **GIVEN** teacher T has an operator-maintained assignment to P1 but no creator/collaborator relationship
- **WHEN** T consults the project
- **THEN** authorized project list/detail SHALL include P1 and unrelated P2 SHALL remain inaccessible
- **AND** the assignment SHALL NOT itself authorize member management or any other mutation

#### Scenario: Teacher who created the project
- **GIVEN** authenticated teacher T is creator/owner of P1 with or without an additional teacher assignment
- **WHEN** T performs an operation already authorized for its owner relationship
- **THEN** the existing owner permissions SHALL remain available without requiring a teacher assignment
- **AND** that relationship SHALL NOT grant access to unrelated projects

#### Scenario: Teacher with active collaborator membership
- **GIVEN** teacher T has an active collaborator membership for P1 with or without an explicit assignment
- **WHEN** T requests an operation permitted to an existing collaborator
- **THEN** those collaborator permissions SHALL remain unchanged and no owner-only permission SHALL be inferred from the teacher role

#### Scenario: Multiple authorized relationships
- **GIVEN** the teacher is creator, collaborator or assigned through multiple authorized paths to the same project
- **WHEN** the server assembles the project list
- **THEN** the project SHALL appear once and the server SHALL not expose projects outside the union of authorized relationships

#### Scenario: Membership removal with an independent assignment
- **GIVEN** teacher T has an active collaborator membership and an independent assignment to P
- **WHEN** the membership is removed while the assignment remains valid
- **THEN** assignment-based project consultation SHALL remain available while membership-based permissions SHALL be withdrawn according to their existing rules
- **AND** removing the final authorized relationship SHALL cause project list omission and detail 404

#### Scenario: Client attempts privilege selection
- **GIVEN** a client submits role=teacher, role=admin, an assignment claim, or an identity override without a trusted server authorization
- **WHEN** protected project functionality is requested
- **THEN** those inputs SHALL NOT create a role, assignment or access permission

#### Scenario: Operator assignments without self-grant
- **GIVEN** only an authorized operator can maintain explicit assignments
- **WHEN** a teacher or another client attempts to assign themselves through product endpoints
- **THEN** no assignment SHALL be created and no endpoint SHALL grant self-assignment
- **AND** synthetic operator fixtures SHALL NOT be represented as a completed institutional integration

#### Scenario: Assignment source failure
- **GIVEN** the assignment source is unavailable or returns no authorized assignment
- **WHEN** teacher access depends on that assignment alone
- **THEN** the system SHALL fail closed without global access or permissive in-memory fallback
- **AND** already valid creator/collaborator relationships SHALL retain their specified authorization independent of the assignment source
## Local implementation evidence

Implementation and bounded local tests are recorded in evidence/epic-002-remote-preparation/20261026-dp-ds/README.md and evidence/teacher-project-scope/20261026-ds/README.md. No remote acceptance, institutional source integration, deployment or EPIC closure is asserted.
