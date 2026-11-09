CREATE TABLE public.teacher_review_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  requester_id text NOT NULL CHECK (length(btrim(requester_id)) > 0),
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
  description text NOT NULL CHECK (char_length(description) BETWEEN 10 AND 2000),
  evidence_url text CHECK (char_length(evidence_url) <= 500),
  status text NOT NULL CHECK (status IN ('PENDING', 'CHANGES_REQUESTED', 'APPROVED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.teacher_review_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_request_id uuid NOT NULL REFERENCES public.teacher_review_requests(id) ON DELETE RESTRICT,
  sequence_number integer NOT NULL CHECK (sequence_number >= 1),
  actor_id text NOT NULL CHECK (length(btrim(actor_id)) > 0),
  actor_role text NOT NULL CHECK (actor_role IN ('student', 'teacher')),
  action_type text NOT NULL CHECK (action_type IN ('TEACHER_RESPONSE', 'STUDENT_RESUBMISSION')),
  status text NOT NULL CHECK (status IN ('PENDING', 'CHANGES_REQUESTED', 'APPROVED')),
  comment text NOT NULL CHECK (char_length(comment) BETWEEN 5 AND 2000),
  evidence_url text CHECK (char_length(evidence_url) <= 500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (review_request_id, sequence_number)
);

CREATE INDEX teacher_review_requests_project_idx ON public.teacher_review_requests(project_id, created_at DESC);
CREATE INDEX teacher_review_actions_request_idx ON public.teacher_review_actions(review_request_id, sequence_number ASC);

