ALTER TABLE public.task_assignees DROP CONSTRAINT task_assignees_pkey;
ALTER TABLE public.task_assignees DROP CONSTRAINT task_assignees_task_id_position_key;
ALTER TABLE public.task_assignees ADD PRIMARY KEY (task_id,position);
CREATE INDEX task_assignees_task_user_idx ON public.task_assignees(task_id,user_id);
