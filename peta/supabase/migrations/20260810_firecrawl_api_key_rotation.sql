-- ============================================================
-- PeTa — Firecrawl API Key Rotation System
--
-- Stores multiple Firecrawl API keys with auto-rotation logic.
-- When a key's credits are exhausted (429/402 error), the system
-- automatically switches to the next available key.
--
-- This is an ADDITIVE migration — does NOT affect existing systems.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. NEW TABLE: firecrawl_api_keys
--    Stores multiple API keys with status tracking.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.firecrawl_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key text NOT NULL,
  label text,  -- Optional label for admin reference (e.g., "Key 1 - Personal")
  is_active boolean NOT NULL DEFAULT true,
  is_exhausted boolean NOT NULL DEFAULT false,
  credits_remaining int,  -- NULL = unknown, updated after each call
  last_used_at timestamptz,
  last_error text,  -- Stores last error message for debugging
  exhausted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- Index for quick lookup of available keys
CREATE INDEX IF NOT EXISTS idx_firecrawl_api_keys_active
  ON public.firecrawl_api_keys (is_active, is_exhausted)
  WHERE is_active = true AND is_exhausted = false;

-- RLS: Only admin can manage keys
ALTER TABLE public.firecrawl_api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "firecrawl_keys_admin_all" ON public.firecrawl_api_keys;
CREATE POLICY "firecrawl_keys_admin_all" ON public.firecrawl_api_keys
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ------------------------------------------------------------
-- 2. TRIGGER: Auto-update updated_at
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_firecrawl_api_keys_updated ON public.firecrawl_api_keys;
CREATE TRIGGER trg_firecrawl_api_keys_updated
  BEFORE UPDATE ON public.firecrawl_api_keys
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ------------------------------------------------------------
-- 3. RPC: add_firecrawl_api_key
--    Admin adds a new API key to the rotation pool.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_firecrawl_api_key(
  p_api_key text,
  p_label text DEFAULT NULL
)
RETURNS public.firecrawl_api_keys
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result public.firecrawl_api_keys;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Check for duplicate key
  IF EXISTS (SELECT 1 FROM public.firecrawl_api_keys WHERE api_key = p_api_key) THEN
    RAISE EXCEPTION 'API key sudah ada di database';
  END IF;

  INSERT INTO public.firecrawl_api_keys (api_key, label)
  VALUES (p_api_key, p_label)
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_firecrawl_api_key(text, text) TO authenticated;

-- ------------------------------------------------------------
-- 4. RPC: remove_firecrawl_api_key
--    Admin removes an API key from the rotation pool.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_firecrawl_api_key(
  p_key_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;

  DELETE FROM public.firecrawl_api_keys WHERE id = p_key_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_firecrawl_api_key(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 5. RPC: list_firecrawl_api_keys
--    Admin lists all API keys (masked for security).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_firecrawl_api_keys()
RETURNS TABLE (
  id uuid,
  label text,
  is_active boolean,
  is_exhausted boolean,
  credits_remaining int,
  last_used_at timestamptz,
  last_error text,
  exhausted_at timestamptz,
  created_at timestamptz,
  api_key_preview text  -- First 8 chars + "..." for security
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN QUERY
  SELECT
    k.id,
    k.label,
    k.is_active,
    k.is_exhausted,
    k.credits_remaining,
    k.last_used_at,
    k.last_error,
    k.exhausted_at,
    k.created_at,
    LEFT(k.api_key, 8) || '...' AS api_key_preview
  FROM public.firecrawl_api_keys k
  ORDER BY k.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_firecrawl_api_keys() TO authenticated;

-- ------------------------------------------------------------
-- 6. RPC: reset_firecrawl_api_key
--    Admin resets an exhausted key back to active (e.g., after topping up credits).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_firecrawl_api_key(
  p_key_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;

  UPDATE public.firecrawl_api_keys
     SET is_exhausted = false,
         exhausted_at = NULL,
         last_error = NULL,
         updated_at = NOW()
   WHERE id = p_key_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_firecrawl_api_key(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 7. RPC: get_next_firecrawl_key
--    Returns the next available API key for the edge function.
--    Rotates through keys, skipping exhausted ones.
--    Returns NULL if all keys are exhausted.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_next_firecrawl_key()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  -- Get the least recently used active key that's not exhausted
  SELECT api_key INTO v_key
  FROM public.firecrawl_api_keys
  WHERE is_active = true
    AND is_exhausted = false
  ORDER BY last_used_at ASC NULLS FIRST
  LIMIT 1;

  -- Update last_used_at if we found a key
  IF v_key IS NOT NULL THEN
    UPDATE public.firecrawl_api_keys
       SET last_used_at = NOW()
     WHERE api_key = v_key;
  END IF;

  RETURN v_key;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_next_firecrawl_key() TO service_role;

-- ------------------------------------------------------------
-- 8. RPC: mark_firecrawl_key_exhausted
--    Called by edge function when a key returns 429/402 error.
--    Marks the key as exhausted and returns the next available key.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_firecrawl_key_exhausted(
  p_api_key text,
  p_error_message text DEFAULT NULL
)
RETURNS text  -- Returns next available key, or NULL if all exhausted
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_key text;
BEGIN
  -- Mark the current key as exhausted
  UPDATE public.firecrawl_api_keys
     SET is_exhausted = true,
         exhausted_at = NOW(),
         last_error = p_error_message,
         updated_at = NOW()
   WHERE api_key = p_api_key;

  -- Get next available key
  SELECT api_key INTO v_next_key
  FROM public.firecrawl_api_keys
  WHERE is_active = true
    AND is_exhausted = false
  ORDER BY last_used_at ASC NULLS FIRST
  LIMIT 1;

  -- Update last_used_at if we found a key
  IF v_next_key IS NOT NULL THEN
    UPDATE public.firecrawl_api_keys
       SET last_used_at = NOW()
     WHERE api_key = v_next_key;
  END IF;

  RETURN v_next_key;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_firecrawl_key_exhausted(text, text) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
