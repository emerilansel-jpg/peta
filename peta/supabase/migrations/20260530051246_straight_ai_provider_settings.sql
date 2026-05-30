CREATE TABLE IF NOT EXISTS public.straight_ai_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE,
  draft_provider TEXT NOT NULL DEFAULT 'deepseek'
    CHECK (draft_provider IN ('deepseek', 'claude')),
  claude_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
  deepseek_model TEXT NOT NULL DEFAULT 'deepseek-chat',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id),
  CONSTRAINT straight_ai_settings_singleton CHECK (id = TRUE)
);

INSERT INTO public.straight_ai_settings (id, draft_provider, claude_model, deepseek_model)
VALUES (TRUE, 'deepseek', 'claude-sonnet-4-20250514', 'deepseek-chat')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.straight_ai_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS straight_ai_settings_read_authenticated ON public.straight_ai_settings;
CREATE POLICY straight_ai_settings_read_authenticated
  ON public.straight_ai_settings
  FOR SELECT
  TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS straight_ai_settings_admin_update ON public.straight_ai_settings;
CREATE POLICY straight_ai_settings_admin_update
  ON public.straight_ai_settings
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.admin_get_straight_ai_settings()
RETURNS TABLE (
  draft_provider TEXT,
  claude_model TEXT,
  deepseek_model TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    s.draft_provider,
    s.claude_model,
    s.deepseek_model,
    s.updated_at
  FROM public.straight_ai_settings s
  WHERE s.id = TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_straight_ai_settings(
  p_draft_provider TEXT,
  p_claude_model TEXT DEFAULT NULL,
  p_deepseek_model TEXT DEFAULT NULL
)
RETURNS public.straight_ai_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_row public.straight_ai_settings;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_draft_provider NOT IN ('deepseek', 'claude') THEN
    RAISE EXCEPTION 'invalid_provider';
  END IF;

  UPDATE public.straight_ai_settings
  SET
    draft_provider = p_draft_provider,
    claude_model = COALESCE(NULLIF(trim(p_claude_model), ''), claude_model),
    deepseek_model = COALESCE(NULLIF(trim(p_deepseek_model), ''), deepseek_model),
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id = TRUE
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    INSERT INTO public.straight_ai_settings (
      id,
      draft_provider,
      claude_model,
      deepseek_model,
      updated_by
    )
    VALUES (
      TRUE,
      p_draft_provider,
      COALESCE(NULLIF(trim(p_claude_model), ''), 'claude-sonnet-4-20250514'),
      COALESCE(NULLIF(trim(p_deepseek_model), ''), 'deepseek-chat'),
      auth.uid()
    )
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_straight_ai_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_straight_ai_settings(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_straight_ai_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_straight_ai_settings(TEXT, TEXT, TEXT) TO authenticated;
