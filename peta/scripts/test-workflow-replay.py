"""Local schema-only backup replay. Synthetic rows only; no remote connections.
Usage: python test-workflow-replay.py <portable-bin> <extracted-schema.sql>
Requires isolated PostgreSQL on 127.0.0.1:55439. Recreates ONLY workflow_replay.
"""
import os, re, subprocess, sys
from pathlib import Path
bin_dir, schema_path = map(Path, sys.argv[1:])
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
args = [str(bin_dir / 'psql.exe'), '-X', '-h', '127.0.0.1', '-p', '55439', '-U', 'postgres']
def run(sql, db='workflow_replay', strict=True):
    p = subprocess.run(args + ['-d', db] + (['-v', 'ON_ERROR_STOP=1'] if strict else []), input=sql, text=True, capture_output=True, env=env)
    if p.returncode:
        # Synthetic fixture only. Never print schema bodies or backup data.
        print('\n'.join(x for x in p.stderr.splitlines() if 'ERROR:' in x))
        raise SystemExit(p.returncode)
    return p
schema = schema_path.read_text()
roles = set(re.findall(r'OWNER TO ([^;]+)', schema)) | {'anon','authenticated','service_role','authenticator','dashboard_user','supabase_read_only_user','supabase_replication_admin'}
run(''.join('DO $$ BEGIN CREATE ROLE '+r+'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;' for r in roles if r != 'postgres') + 'DROP DATABASE IF EXISTS workflow_replay; CREATE DATABASE workflow_replay;', 'postgres')
r = run(schema, strict=False)
errors = [x for x in r.stderr.splitlines() if 'ERROR:' in x]
print('Backup schema restore errors:', len(errors), '(portable Supabase extension limitations; not full parity)')
# No actual HTTP or cron execution: absent extension stubs are LOCAL ONLY.
run("""
CREATE SCHEMA IF NOT EXISTS net;
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds int DEFAULT 1000) RETURNS bigint LANGUAGE sql AS $$ SELECT 0::bigint $$;
CREATE FUNCTION net.http_get(url text, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds int DEFAULT 1000) RETURNS bigint LANGUAGE sql AS $$ SELECT 0::bigint $$;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
('00000000-0000-0000-0000-000000000001','owner@example.invalid','{}'),
('00000000-0000-0000-0000-000000000002','other@example.invalid','{}'),
('00000000-0000-0000-0000-000000000003','admin@example.invalid','{}');
UPDATE public.users SET role='admin' WHERE id='00000000-0000-0000-0000-000000000003';
UPDATE public.users SET credit_balance=100000;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',false);
-- Simulate a paid pre-migration order missing its imported task, preserving ledger creation.
ALTER TABLE public.reddit_upvote_orders DISABLE TRIGGER trg_auto_import_reddit_order;
SELECT public.fn_create_reddit_upvote_order('https://www.reddit.com/r/test/comments/legacy','test',1,'legacy');
ALTER TABLE public.reddit_upvote_orders ENABLE TRIGGER trg_auto_import_reddit_order;
""")
root = Path(__file__).resolve().parents[1]
for path in sorted((root / 'supabase/migrations').glob('20260910*.sql')):
    run(path.read_text()); print('PASS migration', path.name)
run("""
BEGIN;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
CREATE FUNCTION pg_temp.denied(command text, expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE message text;
BEGIN
 BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN
 GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
 IF position(expected in message)=0 THEN RAISE EXCEPTION 'Unexpected error: %',message; END IF;
 RETURN;
 END;
 RAISE EXCEPTION 'Attack succeeded';
END $$;
DO $$ BEGIN ASSERT NOT public.contributor_pilot_enabled(); ASSERT (SELECT count(*)=1 FROM public.legacy_paid_vote_orders); END $$;
SELECT public.fn_ensure_order_task(o) FROM public.reddit_upvote_orders o WHERE notes='legacy';
DO $$ BEGIN ASSERT (SELECT count(*)=1 FROM public.tasks WHERE task_category='reddit_upvote' AND eligibility_status='legacy'); END $$;
CREATE TEMP TABLE checkout_before AS SELECT credit_balance, (SELECT count(*) FROM public.credit_transactions) AS ledger_count FROM public.users WHERE id=auth.uid();
SELECT pg_temp.denied($q$SELECT public.fn_create_reddit_upvote_order('https://www.reddit.com/r/test/comments/new','test',1,'new')$q$,'paid_reddit_votes_disabled');
DO $$ BEGIN
 ASSERT (SELECT u.credit_balance=b.credit_balance FROM public.users u CROSS JOIN checkout_before b WHERE u.id=auth.uid()), 'Rejected vote charged buyer';
 ASSERT (SELECT count(*) FROM public.credit_transactions)=(SELECT ledger_count FROM checkout_before), 'Rejected vote wrote ledger';
END $$;
SELECT pg_temp.denied($q$UPDATE public.reddit_upvote_orders SET requested_upvotes=2 WHERE notes='legacy'$q$,'legacy_vote_obligation_immutable');
DO $$ BEGIN ASSERT (SELECT count(*)=1 FROM public.reddit_upvote_orders); END $$;
INSERT INTO public.contributor_pilot_users VALUES('00000000-0000-0000-0000-000000000001');
SELECT pg_temp.denied($q$SELECT public.fn_create_forum_comment_order('https://www.reddit.com/r/test/comments/screen','reddit','This is a sufficiently long comment',false,'Brand','example.com','plain',NULL,NULL)$q$,'screening_required');
-- Local-only service insertion represents already-authenticated screening response.
INSERT INTO public.straight_order_screenings(user_id,payload,verdict,reason,rules_available)
VALUES(auth.uid(),jsonb_build_object('target_url','https://www.reddit.com/r/test/comments/screen','platform','reddit','comment_text','This is a sufficiently long comment','use_suggested_comment',false,'brand_name','Brand','brand_domain','example.com','brand_mention_mode','plain','source_keyword',NULL,'notes',NULL,'quantity',1,'comment_drafts','[]'::jsonb,'is_reply',false,'reply_to',NULL),'pass','local synthetic',true);
SET LOCAL ROLE authenticated;
SELECT public.fn_create_forum_comment_order('https://www.reddit.com/r/test/comments/screen','reddit','This is a sufficiently long comment',false,'Brand','example.com','plain',NULL,NULL);
SELECT pg_temp.denied($q$SELECT public.fn_create_forum_comment_order('https://www.reddit.com/r/test/comments/screen','reddit','This is a sufficiently long comment',false,'Brand','example.com','plain',NULL,NULL)$q$,'screening_required');
RESET ROLE;
DO $$ BEGIN ASSERT (SELECT count(*)=1 FROM public.straight_order_screenings WHERE consumed_at IS NOT NULL); ASSERT (SELECT count(*)=1 FROM public.tasks WHERE eligibility_status='pending' AND status='paused'); END $$;
SELECT public.fn_create_forum_comment_order('https://forum.example.com/thread','forum','This is a sufficiently long comment',false,'Brand','example.com','plain',NULL,NULL);
DO $$ BEGIN ASSERT (SELECT count(*)=1 FROM public.tasks WHERE source_order_id IN (SELECT id FROM public.reddit_upvote_orders WHERE thread_url='https://forum.example.com/thread') AND eligibility_status='legacy'); END $$;
DO $$ BEGIN
 ASSERT (SELECT b.credit_balance-u.credit_balance FROM public.users u CROSS JOIN checkout_before b WHERE u.id=auth.uid()) = (SELECT sum(cost_credits) FROM public.reddit_upvote_orders WHERE notes IS DISTINCT FROM 'legacy'), 'Successful checkout debit mismatch';
END $$;
CREATE TEMP TABLE bulk_before AS SELECT credit_balance, (SELECT count(*) FROM public.reddit_upvote_orders) AS orders, (SELECT count(*) FROM public.tasks) AS tasks, (SELECT count(*) FROM public.credit_transactions) AS ledger_count FROM public.users WHERE id=auth.uid();
SELECT pg_temp.denied($q$SELECT public.fn_create_forum_comment_orders_bulk('[{"target_url":"https://forum.example.com/bulk","platform":"forum","comment_text":"This is a sufficiently long comment","use_suggested_comment":false,"brand_name":"Brand","brand_domain":"example.com","brand_mention_mode":"plain","quantity":1,"comment_drafts":[],"is_reply":false},{"target_url":"https://forum.example.com/bad","platform":"forum","comment_text":"short","use_suggested_comment":false,"brand_name":"Brand","brand_domain":"example.com","brand_mention_mode":"plain","quantity":1,"comment_drafts":[],"is_reply":false}]'::jsonb)$q$,'comment_text too short');
DO $$ BEGIN
 ASSERT (SELECT u.credit_balance=b.credit_balance FROM public.users u CROSS JOIN bulk_before b WHERE u.id=auth.uid()), 'Failed bulk charged buyer';
 ASSERT (SELECT count(*) FROM public.reddit_upvote_orders)=(SELECT orders FROM bulk_before), 'Failed bulk left orders';
 ASSERT (SELECT count(*) FROM public.tasks)=(SELECT tasks FROM bulk_before), 'Failed bulk left tasks';
 ASSERT (SELECT count(*) FROM public.credit_transactions)=(SELECT ledger_count FROM bulk_before), 'Failed bulk left ledger';
END $$;
ROLLBACK;
""")
# Real legacy claim assigns the reserved draft after INSERT. Must work with pilot OFF.
run("""
BEGIN;
CREATE FUNCTION pg_temp.denied(command text, expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE message text;
BEGIN
 BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN
 GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
 IF position(expected in message)=0 THEN RAISE EXCEPTION 'Unexpected error: %',message; END IF;
 RETURN;
 END;
 RAISE EXCEPTION 'Attack succeeded';
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SELECT public.fn_create_forum_comment_order('https://forum.example.com/legacy-claim','forum','This is a sufficiently long comment',false,'Brand','example.com','plain',NULL,NULL,1,'[{"comment_text":"This is a sufficiently long comment"}]'::jsonb);
SET LOCAL ROLE authenticated;
SELECT public.claim_task_assignment(t.id) FROM public.tasks t
WHERE t.source_order_id IN (SELECT id FROM public.reddit_upvote_orders WHERE thread_url='https://forum.example.com/legacy-claim');
RESET ROLE;
DO $$ BEGIN ASSERT EXISTS (SELECT 1 FROM public.task_assignments a JOIN public.tasks t ON t.id=a.task_id WHERE t.target_url='https://forum.example.com/legacy-claim' AND a.draft_comment='This is a sufficiently long comment'); END $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.denied($q$UPDATE public.task_assignments SET draft_comment='tampered'$q$,'assignment_draft_immutable');
SELECT pg_temp.denied($q$INSERT INTO public.assignment_write_capabilities VALUES(txid_current(),pg_backend_pid(),'expire',NULL)$q$,'permission denied');
SELECT pg_temp.denied($q$SELECT public.cancel_expired_assignments_internal()$q$,'permission denied');
SELECT pg_temp.denied($q$SELECT public.cancel_expired_assignments()$q$,'permission denied');
SELECT set_config('app.assignment_operation','expire',true);
SELECT pg_temp.denied($q$UPDATE public.task_assignments SET status='rejected',can_retry=false,admin_notes='Auto-cancelled: tidak submit dalam 24 jam'$q$,'assignment_server_fields');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
UPDATE public.task_assignments SET expires_at=now()-interval '1 minute';
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
DO $$ BEGIN ASSERT public.cancel_expired_assignments()=1; ASSERT public.cancel_expired_assignments()=0;
ASSERT NOT EXISTS(SELECT 1 FROM public.assignment_write_capabilities);
ASSERT NOT EXISTS(SELECT 1 FROM public.user_credits WHERE source='task_reward');
END $$;
ROLLBACK;
""")
print('PASS backup-schema migration replay + real checkout/legacy tests, local HTTP mocks; extension parity incomplete')
