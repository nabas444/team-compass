-- Helper: is the user a leader of the group?
CREATE OR REPLACE FUNCTION public.is_group_leader(_user_id uuid, _group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = _user_id AND group_id = _group_id AND role = 'leader'
  )
$$;

-- ============ group_invites ============
CREATE TABLE public.group_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX idx_group_invites_group ON public.group_invites(group_id);
CREATE INDEX idx_group_invites_code ON public.group_invites(code);

ALTER TABLE public.group_invites ENABLE ROW LEVEL SECURITY;

-- Members can see invites for their group
CREATE POLICY "group_invites_select_members"
ON public.group_invites FOR SELECT TO authenticated
USING (public.is_group_member(auth.uid(), group_id));

-- Leaders can create invites
CREATE POLICY "group_invites_insert_leader"
ON public.group_invites FOR INSERT TO authenticated
WITH CHECK (public.is_group_leader(auth.uid(), group_id) AND created_by = auth.uid());

-- Leaders can revoke (update) / delete their group's invites
CREATE POLICY "group_invites_update_leader"
ON public.group_invites FOR UPDATE TO authenticated
USING (public.is_group_leader(auth.uid(), group_id))
WITH CHECK (public.is_group_leader(auth.uid(), group_id));

CREATE POLICY "group_invites_delete_leader"
ON public.group_invites FOR DELETE TO authenticated
USING (public.is_group_leader(auth.uid(), group_id));

-- ============ group_join_requests ============
CREATE TABLE public.group_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  invite_id uuid REFERENCES public.group_invites(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  UNIQUE (group_id, user_id, status)
);

CREATE INDEX idx_join_requests_group ON public.group_join_requests(group_id);
CREATE INDEX idx_join_requests_user ON public.group_join_requests(user_id);

ALTER TABLE public.group_join_requests ENABLE ROW LEVEL SECURITY;

-- Users can see their own requests; leaders can see requests for their groups
CREATE POLICY "join_requests_select_own_or_leader"
ON public.group_join_requests FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_group_leader(auth.uid(), group_id));

-- Users insert their own request
CREATE POLICY "join_requests_insert_self"
ON public.group_join_requests FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

-- Leaders update (approve/decline) requests
CREATE POLICY "join_requests_update_leader"
ON public.group_join_requests FOR UPDATE TO authenticated
USING (public.is_group_leader(auth.uid(), group_id))
WITH CHECK (public.is_group_leader(auth.uid(), group_id));

-- Users can withdraw their own pending request
CREATE POLICY "join_requests_delete_own_or_leader"
ON public.group_join_requests FOR DELETE TO authenticated
USING (user_id = auth.uid() OR public.is_group_leader(auth.uid(), group_id));

-- ============ Memberships: leaders can manage ============
-- Add insert/update/delete by leaders (existing policies already cover self/creator).
CREATE POLICY "memberships_insert_leader"
ON public.memberships FOR INSERT TO authenticated
WITH CHECK (public.is_group_leader(auth.uid(), group_id));

CREATE POLICY "memberships_update_leader"
ON public.memberships FOR UPDATE TO authenticated
USING (public.is_group_leader(auth.uid(), group_id))
WITH CHECK (public.is_group_leader(auth.uid(), group_id));

CREATE POLICY "memberships_delete_leader"
ON public.memberships FOR DELETE TO authenticated
USING (public.is_group_leader(auth.uid(), group_id));

-- ============ Groups: members can update name/description ============
CREATE POLICY "groups_update_leader"
ON public.groups FOR UPDATE TO authenticated
USING (public.is_group_leader(auth.uid(), id))
WITH CHECK (public.is_group_leader(auth.uid(), id));
