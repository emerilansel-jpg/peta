BEGIN;

-- The mutation RPC is internal only. Member replacements must go through
-- request_reddit_account_replacement -> admin_review_replacement_request.
REVOKE ALL ON FUNCTION public.replace_user_reddit_account(text, text, int, int, uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_replace_user_reddit_account(
  p_new_username text,
  p_reason text,
  p_initial_karma int DEFAULT 0,
  p_initial_age_days int DEFAULT 0,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'target user is required' USING ERRCODE = '22023';
  END IF;

  RETURN public.replace_user_reddit_account(
    p_new_username,
    p_reason,
    p_initial_karma,
    p_initial_age_days,
    p_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_replace_user_reddit_account(text, text, int, int, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_replace_user_reddit_account(text, text, int, int, uuid)
  TO authenticated;

COMMIT;
