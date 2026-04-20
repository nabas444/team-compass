-- Phase 4: Behavior Insights

CREATE OR REPLACE FUNCTION public.behavior_insights(
  _group_id UUID,
  _lookback_days INT DEFAULT 30
)
RETURNS TABLE (
  user_id UUID,
  total_actions INT,
  tasks_completed INT,
  tasks_late INT,
  late_ratio NUMERIC,
  days_since_last_action INT,
  flags TEXT[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _since TIMESTAMPTZ := now() - (_lookback_days || ' days')::INTERVAL;
BEGIN
  IF NOT public.is_group_member(auth.uid(), _group_id) THEN
    RAISE EXCEPTION 'Not a member of this group';
  END IF;

  RETURN QUERY
  WITH members AS (
    SELECT m.user_id FROM public.memberships m WHERE m.group_id = _group_id
  ),
  activity AS (
    SELECT
      a.actor_id AS user_id,
      COUNT(*)::INT AS total_actions,
      MAX(a.created_at) AS last_action_at
    FROM public.activity_logs a
    WHERE a.group_id = _group_id
      AND a.actor_id IS NOT NULL
      AND a.created_at >= _since
    GROUP BY a.actor_id
  ),
  task_stats AS (
    SELECT
      t.assigned_to AS user_id,
      COUNT(*)::INT AS assigned_total,
      COUNT(*) FILTER (WHERE t.status = 'completed')::INT AS completed_total,
      COUNT(*) FILTER (
        WHERE t.status = 'completed'
          AND t.deadline IS NOT NULL
          AND t.updated_at > t.deadline
      )::INT AS late_total
    FROM public.tasks t
    WHERE t.group_id = _group_id
      AND t.assigned_to IS NOT NULL
    GROUP BY t.assigned_to
  ),
  combined AS (
    SELECT
      m.user_id,
      COALESCE(act.total_actions, 0) AS total_actions,
      COALESCE(ts.completed_total, 0) AS tasks_completed,
      COALESCE(ts.late_total, 0) AS tasks_late,
      COALESCE(ts.assigned_total, 0) AS assigned_total,
      CASE
        WHEN COALESCE(ts.completed_total, 0) = 0 THEN 0::NUMERIC
        ELSE ROUND((ts.late_total::NUMERIC / ts.completed_total::NUMERIC), 2)
      END AS late_ratio,
      CASE
        WHEN act.last_action_at IS NULL THEN NULL
        ELSE EXTRACT(DAY FROM (now() - act.last_action_at))::INT
      END AS days_since_last_action
    FROM members m
    LEFT JOIN activity act ON act.user_id = m.user_id
    LEFT JOIN task_stats ts ON ts.user_id = m.user_id
  )
  SELECT
    c.user_id,
    c.total_actions,
    c.tasks_completed,
    c.tasks_late,
    c.late_ratio,
    c.days_since_last_action,
    ARRAY(
      SELECT flag FROM (
        SELECT 'inactive' AS flag WHERE c.total_actions = 0
        UNION ALL
        SELECT 'low_engagement' WHERE c.total_actions > 0 AND c.total_actions < 3
        UNION ALL
        SELECT 'consistently_late' WHERE c.tasks_completed > 0 AND c.late_ratio > 0.5
        UNION ALL
        SELECT 'never_completes' WHERE c.assigned_total > 0 AND c.tasks_completed = 0
        UNION ALL
        SELECT 'healthy'
          WHERE c.total_actions >= 3
            AND (c.tasks_completed = 0 OR c.late_ratio <= 0.5)
            AND NOT (c.assigned_total > 0 AND c.tasks_completed = 0)
      ) f
    ) AS flags
  FROM combined c;
END;
$$;