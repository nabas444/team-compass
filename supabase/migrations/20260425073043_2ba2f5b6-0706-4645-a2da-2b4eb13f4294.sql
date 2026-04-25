CREATE OR REPLACE FUNCTION public.redeem_invite_code(_code text)
 RETURNS TABLE(group_id uuid, group_name text, already_member boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _invite_id uuid;
  _invite_group_id uuid;
  _invite_revoked timestamptz;
  _invite_expires timestamptz;
  _existing uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT i.id, i.group_id, i.revoked_at, i.expires_at
    INTO _invite_id, _invite_group_id, _invite_revoked, _invite_expires
  FROM public.group_invites i
  WHERE i.code = upper(trim(_code))
  LIMIT 1;

  IF _invite_id IS NULL THEN
    RAISE EXCEPTION 'Invalid invite code';
  END IF;

  IF _invite_revoked IS NOT NULL THEN
    RAISE EXCEPTION 'This invite has been revoked';
  END IF;

  IF _invite_expires IS NOT NULL AND _invite_expires < now() THEN
    RAISE EXCEPTION 'This invite has expired';
  END IF;

  -- Already a member?
  SELECT m.id INTO _existing
  FROM public.memberships m
  WHERE m.group_id = _invite_group_id AND m.user_id = _uid
  LIMIT 1;

  IF _existing IS NOT NULL THEN
    RETURN QUERY
      SELECT g.id, g.name, true
      FROM public.groups g WHERE g.id = _invite_group_id;
    RETURN;
  END IF;

  -- Add as member of the dedicated group
  INSERT INTO public.memberships (group_id, user_id, role)
  VALUES (_invite_group_id, _uid, 'member');

  -- Mark any pending join request resolved
  UPDATE public.group_join_requests AS jr
     SET status = 'approved', resolved_at = now(), resolved_by = _uid
   WHERE jr.group_id = _invite_group_id
     AND jr.user_id = _uid
     AND jr.status = 'pending';

  RETURN QUERY
    SELECT g.id, g.name, false
    FROM public.groups g WHERE g.id = _invite_group_id;
END;
$function$;