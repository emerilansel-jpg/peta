-- =============================================================
-- Forensic safety net: capture every INSERT/UPDATE/DELETE on
-- critical tables so future "data hilang" reports can be
-- investigated (and recovered) instead of guessed.
--
-- Tables watched:
--   tasks                 — PeTa task queue
--   payouts               — army payout requests
--   user_credits          — money ledger
--   reddit_upvote_orders  — Straight Ltd customer orders
--   reddit_accounts       — army Reddit links
--   task_assignments      — work-in-progress (high churn but cheap to log)
--
-- Each row in audit_log holds: table_name, action, actor uid,
-- timestamp, full OLD row (for UPDATE/DELETE) and NEW row (for
-- INSERT/UPDATE) as JSONB. RLS allows admin SELECT only.
--
-- This is RETROACTIVE protection — does not bring back pre-existing
-- losses, but stops any future "where did it go" question dead.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  id           bigserial PRIMARY KEY,
  table_name   text NOT NULL,
  action       text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE','TRUNCATE')),
  actor_id     uuid,                  -- auth.uid() when available
  row_pk       text,                  -- stringified primary key (uuid or int)
  old_row      jsonb,
  new_row      jsonb,
  created_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_log_table_created_idx
  ON public.audit_log (table_name, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx
  ON public.audit_log (actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_log_row_pk_idx
  ON public.audit_log (table_name, row_pk);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_admin_select ON public.audit_log;
CREATE POLICY audit_log_admin_select ON public.audit_log
  FOR SELECT TO authenticated USING (public.is_admin());

-- No INSERT/UPDATE/DELETE policies — only the trigger (SECURITY DEFINER)
-- can write. Service role still has full bypass per default.

-- =============================================================
-- Generic audit trigger function
-- =============================================================
CREATE OR REPLACE FUNCTION public.tg_audit_log()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pk text;
BEGIN
  -- Best-effort PK extraction. For our tables the PK is `id`.
  IF TG_OP = 'DELETE' THEN
    v_pk := COALESCE(OLD.id::text, '');
    INSERT INTO public.audit_log(table_name, action, actor_id, row_pk, old_row, new_row)
    VALUES (TG_TABLE_NAME, 'DELETE', auth.uid(), v_pk, to_jsonb(OLD), NULL);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    v_pk := COALESCE(NEW.id::text, OLD.id::text, '');
    INSERT INTO public.audit_log(table_name, action, actor_id, row_pk, old_row, new_row)
    VALUES (TG_TABLE_NAME, 'UPDATE', auth.uid(), v_pk, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    v_pk := COALESCE(NEW.id::text, '');
    INSERT INTO public.audit_log(table_name, action, actor_id, row_pk, old_row, new_row)
    VALUES (TG_TABLE_NAME, 'INSERT', auth.uid(), v_pk, NULL, to_jsonb(NEW));
    RETURN NEW;
  END IF;
  RETURN NULL;
END $$;

-- =============================================================
-- Attach to critical tables.  Drop-and-recreate so re-running
-- this migration is idempotent.
-- =============================================================

DO $$
DECLARE
  v_table text;
  v_tables CONSTANT text[] := ARRAY[
    'tasks',
    'payouts',
    'user_credits',
    'reddit_upvote_orders',
    'reddit_accounts',
    'task_assignments'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tg_audit_log ON public.%I', v_table);
    EXECUTE format(
      'CREATE TRIGGER tg_audit_log AFTER INSERT OR UPDATE OR DELETE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.tg_audit_log()',
      v_table
    );
  END LOOP;
END $$;

-- Admin-callable RPC: last N changes on a specific table, optionally
-- filtered by action type.  Useful for fast inspect via SQL editor or
-- a future admin UI panel.
CREATE OR REPLACE FUNCTION public.admin_recent_audit(
  p_table text,
  p_limit int DEFAULT 50,
  p_action text DEFAULT NULL
)
RETURNS SETOF public.audit_log
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
    SELECT * FROM public.audit_log
    WHERE table_name = p_table
      AND (p_action IS NULL OR action = p_action)
    ORDER BY created_at DESC
    LIMIT p_limit;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_recent_audit(text, int, text) TO authenticated;
