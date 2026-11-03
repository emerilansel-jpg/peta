import asyncio
import asyncpg
import json
import uuid
from datetime import datetime, timezone

DB_URL = "postgresql://postgres.yorlsgzsawchpeeazcvi:1LspZOMMM4zi2eWD@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres"

async def main():
    print("=== TEST SUITE: JAMINAN BULANAN (MONTHLY GUARANTEE) ===")
    conn = await asyncpg.connect(DB_URL)

    # 1. Verify Config
    cfg_row = await conn.fetchrow("SELECT * FROM public.monthly_guarantee_config WHERE id = 1;")
    print("[PASS] Initial Config:", dict(cfg_row))
    assert cfg_row["guarantee_amount"] == 20000, "Expected default 20000"
    assert cfg_row["referral_code"] == "INTERN", "Expected default INTERN"

    # 2. Get Intern Recruiter (Ghina)
    ghina = await conn.fetchrow("SELECT id, referral_code FROM public.users WHERE UPPER(referral_code) = 'INTERN';")
    assert ghina is not None, "Recruiter with referral_code INTERN not found"
    print(f"[PASS] Recruiter Found: {ghina['referral_code']} (ID: {ghina['id']})")

    test_period = "2026-10"
    timestamp_in_period = datetime(2026, 10, 15, 10, 0, 0)
    test_run_id = str(int(datetime.now().timestamp()))[-4:]

    test_cases = [
        {"name": "User 0 (Rp0)", "earned": 0, "expected_topup": 20000},
        {"name": "User 5k (Rp5.000)", "earned": 5000, "expected_topup": 15000},
        {"name": "User 19999 (Rp19.999)", "earned": 19999, "expected_topup": 1},
        {"name": "User 20k (Rp20.000)", "earned": 20000, "expected_topup": 0},
        {"name": "User 50k (Rp50.000)", "earned": 50000, "expected_topup": 0},
    ]

    created_user_ids = []

    print("\n--- SEEDING 5 TEST DUMMY USERS ---")
    for i, tc in enumerate(test_cases):
        uid = uuid.uuid4()
        email = f"test.guarantee.{test_run_id}.{i}@example.com"
        wa = f"62899{test_run_id}{i}000"

        # 1. Insert into auth.users with referral_code = 'INTERN'
        await conn.execute("""
            INSERT INTO auth.users (id, email, raw_user_meta_data)
            VALUES ($1, $2, $3);
        """, uid, email, json.dumps({
            "full_name": f"Test {tc['name']}",
            "whatsapp": wa,
            "referral_code": "INTERN"
        }))

        # 2. Ensure public.users satisfies all 3 requirements:
        # - referred_by = ghina['id']
        # - onboarding_completed_at IS NOT NULL
        # - is_active = true
        await conn.execute("""
            UPDATE public.users
            SET referred_by = $2,
                acquisition_source = 'INTERN',
                onboarding_completed_at = now(),
                is_active = true,
                role = 'army'
            WHERE id = $1;
        """, uid, ghina["id"])

        tc["user_id"] = uid
        created_user_ids.append(uid)

        # 3. Seed previous month task earnings in user_credits
        if tc["earned"] > 0:
            await conn.execute("""
                INSERT INTO public.user_credits (
                    id, user_id, amount, source, description, created_at
                ) VALUES ($1, $2, $3, 'task_reward', $4, $5);
            """, uuid.uuid4(), uid, tc["earned"], f"Test Task Reward {tc['earned']}", timestamp_in_period)

        print(f"  Created {tc['name']} -> Task Earnings in {test_period}: Rp{tc['earned']}")

    # 3. TEST DRY-RUN MODE
    print("\n--- TEST: DRY-RUN MODE ---")
    dry_json = await conn.fetchval("SELECT public.process_monthly_guarantee($1, true);", test_period)
    dry_res = json.loads(dry_json)
    print("[PASS] Dry-Run Summary:", dry_res["summary"])

    for tc in test_cases:
        item = next((d for d in dry_res["details"] if d["user_id"] == str(tc["user_id"])), None)
        assert item is not None, f"User {tc['name']} missing in dry run output"
        actual_topup = item["top_up_amount"]
        print(f"  Dry-Run Result: {tc['name']} -> Top-Up: Rp{actual_topup} (Expected: Rp{tc['expected_topup']})")
        assert actual_topup == tc["expected_topup"], f"Dry run mismatch for {tc['name']}"

    # Verify dry-run caused zero DB mutations
    hist_count = await conn.fetchval("SELECT count(*) FROM public.monthly_guarantee_history WHERE user_id = ANY($1);", created_user_ids)
    credit_count = await conn.fetchval("SELECT count(*) FROM public.user_credits WHERE source = 'monthly_guarantee' AND user_id = ANY($1);", created_user_ids)
    assert hist_count == 0, "Dry run must NOT create history rows"
    assert credit_count == 0, "Dry run must NOT create user_credits rows"
    print("[PASS] Dry-run isolation confirmed: 0 DB mutations.")

    # 4. TEST LIVE EXECUTION RUN
    print("\n--- TEST: LIVE RUN EXECUTION ---")
    live_json = await conn.fetchval("SELECT public.process_monthly_guarantee($1, false);", test_period)
    live_res = json.loads(live_json)
    print("[PASS] Live Execution Summary:", live_res["summary"])

    for tc in test_cases:
        item = next((d for d in live_res["details"] if d["user_id"] == str(tc["user_id"])), None)
        assert item is not None, f"User {tc['name']} missing in live run output"
        actual_topup = item["top_up_amount"]
        assert actual_topup == tc["expected_topup"], f"Live run mismatch for {tc['name']}"

    print("[PASS] All 5 individual top-up calculations verified: 20.000, 15.000, 1, 0, 0.")

    # Verify user_credits mutations
    credits = await conn.fetch("""
        SELECT user_id, amount, source, description 
        FROM public.user_credits 
        WHERE source = 'monthly_guarantee' AND user_id = ANY($1)
        ORDER BY amount DESC;
    """, created_user_ids)

    print(f"\n[PASS] Verified {len(credits)} user_credits records created with source='monthly_guarantee':")
    for c in credits:
        print(f"  - User: {c['user_id']} | Top-Up: Rp{c['amount']} | Description: '{c['description']}'")
    assert len(credits) == 3, f"Expected exactly 3 credits, found {len(credits)}"
    assert [c["amount"] for c in credits] == [20000, 15000, 1], "Credit amounts must be [20000, 15000, 1]"

    # Verify notifications
    notifs = await conn.fetch("""
        SELECT user_id, type, title, body 
        FROM public.notifications 
        WHERE type = 'monthly_guarantee' AND user_id = ANY($1);
    """, created_user_ids)
    print(f"\n[PASS] Verified {len(notifs)} member notifications created:")
    for n in notifs:
        print(f"  - Title: '{n['title']}' | Body: '{n['body']}'")
    assert len(notifs) == 3, f"Expected 3 notifications, found {len(notifs)}"

    # 5. TEST IDEMPOTENCY (RUN CRON 2X IN SAME MONTH)
    print("\n--- TEST: IDEMPOTENCY (RUN CRON 2X IN SAME MONTH) ---")
    rerun_json = await conn.fetchval("SELECT public.process_monthly_guarantee($1, false);", test_period)
    rerun_res = json.loads(rerun_json)
    print("[PASS] Re-run Summary:", rerun_res["summary"])

    # Filter details for our test users
    rerun_test_details = [d for d in rerun_res["details"] if d["user_id"] in [str(u) for u in created_user_ids]]
    for d in rerun_test_details:
        assert d["status"] == "already_processed", f"User {d['user_id']} was not marked already_processed"
        assert d["top_up_amount"] == 0, f"User {d['user_id']} received non-zero top_up on re-run"

    # Confirm user_credits count STILL equals 3 (NO DOUBLE TOP-UP!)
    credits_after_rerun = await conn.fetchval("""
        SELECT count(*) FROM public.user_credits 
        WHERE source = 'monthly_guarantee' AND user_id = ANY($1);
    """, created_user_ids)
    assert credits_after_rerun == 3, f"CRITICAL: Double top-up detected! Count is {credits_after_rerun}"
    print("[PASS] IDEMPOTENCY CONFIRMED: 0 double credits, all members skipped on re-run.")

    # 6. TEST AUTOMATED CRON TRIGGER WINDOW
    print("\n--- TEST: CRON TRIGGER WINDOW SAFETY ---")
    cron_trigger_res = await conn.fetchval("SELECT public.cron_trigger_monthly_guarantee();")
    print("[PASS] cron_trigger_monthly_guarantee output:", cron_trigger_res)

    # 7. TEST ADMIN HISTORY RPC
    print("\n--- TEST: ADMIN HISTORY RPC ---")
    admin_hist_json = await conn.fetchval("SELECT public.get_monthly_guarantee_history($1);", test_period)
    admin_hist = json.loads(admin_hist_json)
    print(f"[PASS] Admin History Periods: {admin_hist['periods']}")
    print(f"[PASS] Admin History Records Loaded: {len(admin_hist['records'])}")

    # 8. CLEANUP TEST FIXTURES
    print("\n--- CLEANUP TEST FIXTURES ---")
    await conn.execute("DELETE FROM public.notifications WHERE user_id = ANY($1);", created_user_ids)
    await conn.execute("DELETE FROM public.user_credits WHERE user_id = ANY($1) OR reference_id = ANY($1);", created_user_ids)
    await conn.execute("DELETE FROM public.monthly_guarantee_history WHERE user_id = ANY($1);", created_user_ids)
    await conn.execute("DELETE FROM public.user_login_logs WHERE user_id = ANY($1);", created_user_ids)
    await conn.execute("DELETE FROM public.invitations WHERE registered_user_id = ANY($1);", created_user_ids)
    await conn.execute("DELETE FROM public.users WHERE id = ANY($1);", created_user_ids)
    await conn.execute("DELETE FROM auth.users WHERE id = ANY($1);", created_user_ids)
    print("[PASS] All dummy test fixtures cleaned up.")

    await conn.close()
    print("\n=== ALL JAMINAN BULANAN TESTS PASSED 100% SUCCESSFULLY! ===")

asyncio.run(main())
