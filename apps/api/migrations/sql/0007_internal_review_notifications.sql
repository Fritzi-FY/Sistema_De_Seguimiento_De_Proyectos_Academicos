ALTER TABLE public.teacher_review_requests
  ADD CONSTRAINT review_notification_recipient_source UNIQUE (id, project_id, requester_id);

ALTER TABLE public.teacher_review_actions
  ADD CONSTRAINT review_notification_action_source
  UNIQUE (id, review_request_id, actor_id, status, actor_role, action_type);

CREATE TABLE public.internal_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id text NOT NULL,
  project_id uuid NOT NULL,
  review_id uuid NOT NULL,
  response_action_id uuid NOT NULL,
  reviewer_id text NOT NULL,
  response_status text NOT NULL CHECK (response_status IN ('APPROVED', 'CHANGES_REQUESTED')),
  actor_role text NOT NULL DEFAULT 'teacher' CHECK (actor_role = 'teacher'),
  action_type text NOT NULL DEFAULT 'TEACHER_RESPONSE' CHECK (action_type = 'TEACHER_RESPONSE'),
  kind text NOT NULL DEFAULT 'TEACHER_REVIEW_COMPLETED' CHECK (kind = 'TEACHER_REVIEW_COMPLETED'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT internal_notification_response_recipient UNIQUE (response_action_id, recipient_user_id),
  FOREIGN KEY (review_id, project_id, recipient_user_id)
    REFERENCES public.teacher_review_requests (id, project_id, requester_id) ON DELETE RESTRICT,
  FOREIGN KEY (response_action_id, review_id, reviewer_id, response_status, actor_role, action_type)
    REFERENCES public.teacher_review_actions (id, review_request_id, actor_id, status, actor_role, action_type)
    ON DELETE RESTRICT
);
