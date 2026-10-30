CREATE TABLE projects (
 id uuid PRIMARY KEY,
 title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
 description text CHECK (char_length(description) <= 500),
 course_code text NOT NULL CHECK (char_length(course_code) BETWEEN 2 AND 20),
 status text NOT NULL CHECK (status IN ('active','archived')),
 start_date timestamptz NOT NULL,
 target_date timestamptz NOT NULL CHECK (target_date >= start_date),
 creator_id text NOT NULL CHECK (length(btrim(creator_id)) > 0),
 created_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL
);
CREATE TABLE project_memberships (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 user_id text NOT NULL CHECK (length(btrim(user_id)) > 0),
 role text NOT NULL CHECK (role IN ('owner','collaborator')),
 status text NOT NULL CHECK (status IN ('active','removed')),
 joined_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL,
 removed_at timestamptz,
 CONSTRAINT membership_removal_coherence CHECK (
  (status='active' AND removed_at IS NULL) OR
  (status='removed' AND removed_at IS NOT NULL AND removed_at=updated_at)
 )
);
CREATE UNIQUE INDEX membership_active_pair ON project_memberships(project_id,user_id) WHERE status='active';
CREATE UNIQUE INDEX membership_active_owner ON project_memberships(project_id) WHERE status='active' AND role='owner';
CREATE INDEX membership_active_user ON project_memberships(user_id,project_id) WHERE status='active';
CREATE INDEX projects_creator ON projects(creator_id);
