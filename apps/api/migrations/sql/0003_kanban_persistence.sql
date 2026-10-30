CREATE TABLE public.boards (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL UNIQUE REFERENCES public.projects(id),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, project_id)
);

CREATE TABLE public.board_columns (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  board_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 50),
  category text NOT NULL CHECK (category IN ('TODO','IN_PROGRESS','IN_REVIEW','DONE')),
  color text CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  order_index integer NOT NULL CHECK (order_index >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (board_id,project_id) REFERENCES public.boards(id,project_id),
  UNIQUE (id,project_id),
  UNIQUE (board_id,order_index) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE public.tasks (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id),
  column_id uuid,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 140),
  description text CHECK (char_length(description) <= 2000),
  priority text NOT NULL CHECK (priority IN ('LOW','MEDIUM','HIGH','URGENT')),
  order_index integer CHECK (order_index >= 0),
  due_date timestamptz,
  labels text[] NOT NULL DEFAULT '{}' CHECK (cardinality(labels) <= 5),
  creator_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  CHECK ((NOT deleted AND column_id IS NOT NULL AND order_index IS NOT NULL) OR (deleted AND column_id IS NULL AND order_index IS NULL)),
  FOREIGN KEY (column_id,project_id) REFERENCES public.board_columns(id,project_id),
  UNIQUE (id,project_id),
  UNIQUE (column_id,order_index) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE public.task_assignees (
  task_id uuid NOT NULL,
  project_id uuid NOT NULL,
  user_id text NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (task_id,user_id),
  FOREIGN KEY (task_id,project_id) REFERENCES public.tasks(id,project_id),
  UNIQUE (task_id,position) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE public.task_activity (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  task_id uuid NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('CREATED','UPDATED','MOVED','COLUMN_DELETED_REALLOCATION','DELETED')),
  from_column_id uuid,
  to_column_id uuid,
  details jsonb,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (task_id,project_id) REFERENCES public.tasks(id,project_id)
);

CREATE INDEX tasks_project_order_idx ON public.tasks(project_id,column_id,order_index,created_at) WHERE NOT deleted;
CREATE INDEX task_assignees_project_user_idx ON public.task_assignees(project_id,user_id,task_id);
CREATE INDEX task_activity_task_time_idx ON public.task_activity(task_id,created_at DESC,id);
CREATE INDEX task_activity_project_time_idx ON public.task_activity(project_id,created_at DESC,id);
