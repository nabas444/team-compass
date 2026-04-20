-- Phase 3: Contribution Engine

-- 1. Contributions table
CREATE TABLE public.contributions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  tasks_completed INTEGER NOT NULL DEFAULT 0,
  tasks_late INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  subtasks_completed INTEGER NOT NULL DEFAULT 0,
  last_computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id)
);

CREATE INDEX idx_contributions_group ON public.contributions(group_id);
CREATE INDEX idx_contributions_user ON public.contributions(user_id);

-- updated_at trigger
CREATE TRIGGER trg_contributions_updated_at
BEFORE UPDATE ON public.contributions
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. RLS
ALTER TABLE public.contributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY contributions_select_group_members
ON public.contributions
FOR SELECT
TO authenticated
USING (public.is_group_member(auth.uid(), group_id));

-- No INSERT/UPDATE/DELETE policies — only SECURITY DEFINER function can write.

-- 3. Compute function
CREATE OR REPLACE FUNCTION public.compute_contributions(_group_id UUID)
RETURNS TABLE (
  user_id UUID,
  score INTEGER,
  tasks_completed INTEGER,
  tasks_late INTEGER,
  comments_count INTEGER,
  subtasks_completed INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Permission check: only group members can compute
  IF NOT public.is_group_member(auth.uid(), _group_id) THEN
    RAISE EXCEPTION 'Not a member of this group';
  END IF;

  RETURN QUERY
  WITH members AS (
    SELECT m.user_id FROM public.memberships m WHERE m.group_id = _group_id
  ),
  task_stats AS (
    SELECT
      t.assigned_to AS user_id,
      COUNT(*) FILTER (
        WHERE t.status = 'completed'
          AND (t.deadline IS NULL OR t.updated_at <= t.deadline)
      )::INT AS tasks_on_time,
      COUNT(*) FILTER (
        WHERE t.status = 'completed'
          AND t.deadline IS NOT NULL
          AND t.updated_at > t.deadline
      )::INT AS tasks_late
    FROM public.tasks t
    WHERE t.group_id = _group_id AND t.assigned_to IS NOT NULL
    GROUP BY t.assigned_to
  ),
  comment_stats AS (
    SELECT c.author_id AS user_id, COUNT(*)::INT AS cnt
    FROM public.comments c
    JOIN public.tasks t ON t.id = c.task_id
    WHERE t.group_id = _group_id
    GROUP BY c.author_id
  ),
  subtask_stats AS (
    SELECT s.created_by AS user_id, COUNT(*)::INT AS cnt
    FROM public.subtasks s
    JOIN public.tasks t ON t.id = s.task_id
    WHERE t.group_id = _group_id AND s.completed = true
    GROUP BY s.created_by
  ),
  computed AS (
    SELECT
      m.user_id,
      COALESCE(ts.tasks_on_time, 0) AS tasks_on_time,
      COALESCE(ts.tasks_late, 0) AS tasks_late,
      COALESCE(cs.cnt, 0) AS comments_count,
      COALESCE(ss.cnt, 0) AS subtasks_completed
    FROM members m
    LEFT JOIN task_stats ts ON ts.user_id = m.user_id
    LEFT JOIN comment_stats cs ON cs.user_id = m.user_id
    LEFT JOIN subtask_stats ss ON ss.user_id = m.user_id
  ),
  upserted AS (
    INSERT INTO public.contributions AS c
      (group_id, user_id, score, tasks_completed, tasks_late, comments_count, subtasks_completed, last_computed_at)
    SELECT
      _group_id,
      cp.user_id,
      (cp.tasks_on_time * 10) + (cp.tasks_late * 3) + (cp.comments_count * 1) + (cp.subtasks_completed * 2),
      cp.tasks_on_time,
      cp.tasks_late,
      cp.comments_count,
      cp.subtasks_completed,
      now()
    FROM computed cp
    ON CONFLICT (group_id, user_id) DO UPDATE SET
      score = EXCLUDED.score,
      tasks_completed = EXCLUDED.tasks_completed,
      tasks_late = EXCLUDED.tasks_late,
      comments_count = EXCLUDED.comments_count,
      subtasks_completed = EXCLUDED.subtasks_completed,
      last_computed_at = EXCLUDED.last_computed_at
    RETURNING c.user_id, c.score, c.tasks_completed, c.tasks_late, c.comments_count, c.subtasks_completed
  )
  SELECT u.user_id, u.score, u.tasks_completed, u.tasks_late, u.comments_count, u.subtasks_completed
  FROM upserted u;
END;
$$;