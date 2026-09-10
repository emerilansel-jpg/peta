// Isolated PostgreSQL fixture; never connects remotely. PSQL must name a local binary.
// ponytail: focused production-function tests, not a full Supabase migration replay.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const sql = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const ledger = sql('20260814_fix_stale_sync_and_resync.sql').split('-- 2) Resync')[0].split('CREATE OR REPLACE FUNCTION')[1];
const screening = sql('20260910100000_straight_screening.sql');
const pilot = screening.slice(screening.indexOf('CREATE TABLE public.contributor_pilot_users'), screening.indexOf('CREATE TABLE public.straight_order_screenings'));
const contributor = sql('20260910110000_contributor_workflow.sql').replaceAll('BEGIN;', 'BEGIN;');
const briefSource = sql('20260804_add_reply_to_comment.sql');
const briefStart = briefSource.indexOf('CREATE OR REPLACE FUNCTION public.forum_comment_task_brief');
const brief = briefSource.slice(briefStart, briefSource.indexOf('$$;', briefStart) + 3);
const platformSource = sql('20260808_fix_order_creation_jsonb_typeof.sql');
const platformStart = platformSource.indexOf('CREATE OR REPLACE FUNCTION public.platform_for_url');
const platform = platformSource.slice(platformStart, platformSource.indexOf('$$;', platformStart) + 3);
const standardSource = sql('20260804_add_profile_photo_brief.sql');
const standardStart = standardSource.indexOf('CREATE OR REPLACE FUNCTION public.forum_standard_brief');
const standard = standardSource.slice(standardStart, standardSource.indexOf('$$;', standardStart) + 3);
const fixture = `
BEGIN;
CREATE SCHEMA auth;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text);
CREATE TABLE public.users(id uuid PRIMARY KEY, role text, full_name text);
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND role='admin') $$;
CREATE TABLE reddit_accounts(id uuid PRIMARY KEY,user_id uuid,username text);
CREATE TABLE reddit_upvote_orders(id int PRIMARY KEY,user_id uuid,status text,notes text,target_type text,thread_url text,subreddit text,requested_upvotes int,delivered_upvotes int,completed_at timestamptz,delivery_proof_text text,delivery_proof_url text);
CREATE TABLE legacy_paid_vote_orders(order_id int PRIMARY KEY REFERENCES reddit_upvote_orders(id));
CREATE TABLE straight_settings(auto_activate_tasks boolean); INSERT INTO straight_settings VALUES(true);
CREATE FUNCTION forum_platform_label(text,text) RETURNS text LANGUAGE sql AS $$ SELECT coalesce($2,'Forum') $$;
${platform}
${standard}
${brief}
CREATE TABLE tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title text,description text,brief text,target_url text,task_type text,task_category text,min_karma int,min_account_age_days int,per_account_limit int,min_level int,max_assignments int,reward_amount int,status text,created_by uuid,source_order_id int,updated_at timestamptz);
CREATE TABLE task_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid, user_id uuid,reddit_account_id uuid,status text,proof_url text,submitted_url text,submitted_username text,draft_comment text,user_note text,proof_image_url text,proof_media jsonb,admin_notes text,can_retry boolean,balance_credited_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz);
ALTER TABLE task_assignments ADD COLUMN expires_at timestamptz;
-- Signature fixtures only; real claim/expiry bodies are exercised by test-workflow-replay.py.
CREATE FUNCTION claim_task_assignment(uuid,uuid DEFAULT NULL) RETURNS task_assignments LANGUAGE sql AS $$ SELECT a FROM task_assignments a LIMIT 1 $$;
CREATE FUNCTION cancel_expired_assignments() RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE TABLE user_credits(user_id uuid,amount int,source text,description text,reference_id uuid UNIQUE);
CREATE TABLE activity_logs(user_id uuid,action text,details jsonb);
CREATE FUNCTION admin_pending_approvals() RETURNS void LANGUAGE sql AS $$ SELECT $$;
${pilot}
COMMIT;
${contributor}
${sql('20260910120000_workflow_authorization.sql')}
CREATE OR REPLACE FUNCTION ${ledger}
CREATE TRIGGER tg_on_assignment_approved BEFORE UPDATE ON task_assignments FOR EACH ROW EXECUTE FUNCTION tg_on_assignment_approved();
ALTER TABLE task_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_update ON task_assignments FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT,INSERT,UPDATE ON task_assignments TO authenticated;
GRANT SELECT ON tasks,reddit_accounts TO authenticated;
CREATE FUNCTION pg_temp.denied(command text, expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE message text;
BEGIN
  BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS message = MESSAGE_TEXT;
    IF position(expected in message)=0 THEN RAISE EXCEPTION 'Unexpected error: %',message; END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Attack succeeded: %', command;
END $$;
BEGIN;
INSERT INTO users VALUES('00000000-0000-0000-0000-000000000001','army','Owner'),('00000000-0000-0000-0000-000000000002','army','Other'),('00000000-0000-0000-0000-000000000003','admin','Admin');
SELECT set_config('test.uid','00000000-0000-0000-0000-000000000001',false);
DO $$ BEGIN ASSERT NOT contributor_pilot_enabled(), 'pilot must default off'; END $$;
INSERT INTO tasks(id,title,task_category,status,reward_amount) VALUES('10000000-0000-0000-0000-000000000001','legacy','forum_comment','active',5000);
SET LOCAL ROLE authenticated;
INSERT INTO task_assignments(id,task_id,user_id,status,draft_comment) VALUES('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',auth.uid(),'in_progress','immutable');
SELECT pg_temp.denied($a$UPDATE task_assignments SET status='approved'$a$,'assignment_server_fields');
SELECT pg_temp.denied($a$UPDATE task_assignments SET visibility_status='visible'$a$,'assignment_server_fields');
SELECT pg_temp.denied($a$UPDATE task_assignments SET contributor_workflow=true$a$,'assignment_workflow_immutable');
SELECT pg_temp.denied($a$UPDATE task_assignments SET draft_comment='tampered'$a$,'assignment_draft_immutable');
SELECT submit_assignment_proof('20000000-0000-0000-0000-000000000001','https://example.com/proof',NULL,NULL,NULL,'["https://example.com/image"]','note','https://example.com/image');
SELECT pg_temp.denied($a$UPDATE task_assignments SET visibility_check_after=NULL$a$,'assignment_deadline_immutable');
SELECT submit_assignment_proof('20000000-0000-0000-0000-000000000001','https://example.com/retry');
DO $$ BEGIN ASSERT (SELECT visibility_check_after=first_proof_submitted_at+interval '72 hours' FROM task_assignments LIMIT 1); END $$;
SELECT set_config('test.uid','00000000-0000-0000-0000-000000000002',false);
SELECT pg_temp.denied($a$SELECT submit_assignment_proof('20000000-0000-0000-0000-000000000001','bad')$a$,'forbidden');
DO $$ DECLARE n int; BEGIN UPDATE task_assignments SET status='approved'; GET DIAGNOSTICS n=ROW_COUNT; ASSERT n=0; END $$;
RESET ROLE;
DO $$ BEGIN ASSERT (SELECT count(*)=0 FROM user_credits), 'failed approval must roll back ledger'; END $$;
SELECT set_config('test.uid','00000000-0000-0000-0000-000000000003',false);
SELECT admin_approve_assignment('20000000-0000-0000-0000-000000000001');
SELECT pg_temp.denied($a$SELECT admin_approve_assignment('20000000-0000-0000-0000-000000000001')$a$,'status bukan submitted');
DO $$ BEGIN ASSERT (SELECT count(*)=1 AND sum(amount)=5000 FROM user_credits), 'legacy payout exactly once'; END $$;
INSERT INTO contributor_pilot_users VALUES('00000000-0000-0000-0000-000000000001');
INSERT INTO tasks(id,title,task_category,status,eligibility_status,reward_amount) VALUES('10000000-0000-0000-0000-000000000002','pilot','reddit_comment','paused','pending',5000);
SELECT pg_temp.denied($a$UPDATE tasks SET status='active' WHERE eligibility_status='pending'$a$,'task_eligibility_required');
SELECT admin_review_task_eligibility('10000000-0000-0000-0000-000000000002','approved');
SELECT set_config('test.uid','00000000-0000-0000-0000-000000000002',false);
SELECT pg_temp.denied($a$INSERT INTO task_assignments(task_id,user_id,status) VALUES('10000000-0000-0000-0000-000000000002',auth.uid(),'in_progress')$a$,'task_eligibility_or_pilot_required');
SELECT set_config('test.uid','00000000-0000-0000-0000-000000000001',false);
INSERT INTO task_assignments(id,task_id,user_id,status) VALUES('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',auth.uid(),'in_progress');
SELECT set_config('test.uid','00000000-0000-0000-0000-000000000003',false);
SELECT pg_temp.denied($a$SELECT admin_reject_assignment('20000000-0000-0000-0000-000000000002','null visibility')$a$,'unknown_visibility');
SELECT admin_review_assignment_visibility('20000000-0000-0000-0000-000000000002','not_visible');
SELECT pg_temp.denied($a$SELECT admin_reject_assignment('20000000-0000-0000-0000-000000000002','null deadline')$a$,'wait_72h');
SELECT pg_temp.denied($a$UPDATE task_assignments SET status='rejected' WHERE id='20000000-0000-0000-0000-000000000002'$a$,'rejection_not_ready');
SELECT submit_assignment_proof('20000000-0000-0000-0000-000000000002','https://example.com/proof');
SELECT pg_temp.denied($a$SELECT admin_approve_assignment('20000000-0000-0000-0000-000000000002')$a$,'requires_visible');
SELECT admin_review_assignment_visibility('20000000-0000-0000-0000-000000000002','unknown');
SELECT pg_temp.denied($a$SELECT admin_reject_assignment('20000000-0000-0000-0000-000000000002','unknown')$a$,'unknown_visibility');
SELECT admin_review_assignment_visibility('20000000-0000-0000-0000-000000000002','not_visible');
SELECT pg_temp.denied($a$SELECT admin_reject_assignment('20000000-0000-0000-0000-000000000002','too early')$a$,'wait_72h');
SELECT admin_review_assignment_visibility('20000000-0000-0000-0000-000000000002','visible');
SELECT admin_reject_assignment('20000000-0000-0000-0000-000000000002','revise proof',true);
SELECT set_config('test.uid','00000000-0000-0000-0000-000000000001',false);
SELECT submit_assignment_proof('20000000-0000-0000-0000-000000000002','https://example.com/retry');
SELECT pg_temp.denied($a$UPDATE task_assignments SET first_proof_submitted_at=now()-interval '4 days' WHERE id='20000000-0000-0000-0000-000000000002'$a$,'assignment_deadline_immutable');
SELECT set_config('test.uid','00000000-0000-0000-0000-000000000003',false);
DO $$ BEGIN ASSERT (SELECT contributor_workflow AND visibility_check_after=first_proof_submitted_at+interval '72 hours' FROM admin_pending_approvals() WHERE assignment_id='20000000-0000-0000-0000-000000000002'); END $$;

SELECT admin_approve_assignment('20000000-0000-0000-0000-000000000002');
DO $$ BEGIN ASSERT (SELECT count(*)=2 FROM user_credits); END $$;
INSERT INTO reddit_upvote_orders(id,user_id,status,target_type,thread_url,subreddit,requested_upvotes,notes) VALUES(1,'00000000-0000-0000-0000-000000000001','pending','comment','https://forum.example.com/thread','Forum',1,'{"service":"forum_comment","platform":"Forum"}');
SELECT fn_ensure_order_task(o) FROM reddit_upvote_orders o WHERE id=1;
DO $$ BEGIN ASSERT (SELECT status='active' AND eligibility_status='legacy' FROM tasks WHERE source_order_id=1), 'nonReddit preserved'; END $$;
ROLLBACK;
`;
assert.ok(process.env.PSQL, 'Set PSQL to portable psql.exe; requires fresh local DB on 127.0.0.1:55439');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')));
const result = spawnSync(process.env.PSQL, ['-X','-h','127.0.0.1','-p','55439','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'], { input: 'BEGIN;\n' + fixture.replaceAll('COMMIT;', '').replaceAll('BEGIN;\n', ''), encoding: 'utf8', env, });
if (result.status !== 0) console.error(result.stderr || result.error);
assert.equal(result.status, 0, 'isolated PostgreSQL adversarial tests');
console.log('PASS: isolated PostgreSQL production guards/RPCs; fixture schema, not full Supabase replay.');
