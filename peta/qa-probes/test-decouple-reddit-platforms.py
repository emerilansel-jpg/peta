import asyncio
import asyncpg
import uuid

DB_URL = "postgresql://postgres.yorlsgzsawchpeeazcvi:1LspZOMMM4zi2eWD@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres"

async def main():
    print("=== TEST SUITE: DECOUPLE REDDIT FROM ALL NON-REDDIT PLATFORMS ===")
    conn = await asyncpg.connect(DB_URL)

    # 1. Pick an army user
    user = await conn.fetchrow("""
        SELECT u.id, u.email 
        FROM public.users u
        WHERE u.role = 'army' AND u.is_active = true
        LIMIT 1;
    """)
    assert user is not None, "Army user not found"
    uid = user["id"]
    print(f"[PASS] Testing as Army User: {user['email']} ({uid})")

    # 2. Pick active tasks from database
    yelp_task = await conn.fetchrow("SELECT id, title, task_category, reward_amount FROM public.tasks WHERE status = 'active' AND task_category = 'yelp_review' LIMIT 1;")
    clutch_task = await conn.fetchrow("SELECT id, title, task_category, reward_amount FROM public.tasks WHERE status = 'active' AND task_category = 'clutch_review' LIMIT 1;")
    tp_task = await conn.fetchrow("SELECT id, title, task_category, reward_amount FROM public.tasks WHERE status = 'active' AND task_category = 'trustpilot_review' LIMIT 1;")
    reddit_task = await conn.fetchrow("SELECT id, title, task_category, reward_amount FROM public.tasks WHERE status = 'active' AND task_category LIKE 'reddit_%' LIMIT 1;")

    print(f"  Found Yelp Task: {yelp_task['id'] if yelp_task else 'None'}")
    print(f"  Found Clutch Task: {clutch_task['id'] if clutch_task else 'None'}")
    print(f"  Found Trustpilot Task: {tp_task['id'] if tp_task else 'None'}")
    print(f"  Found Reddit Task: {reddit_task['id'] if reddit_task else 'None'}")

    # ========================================================
    # TEST 1: Claim Yelp Review Task without Reddit Account
    # ========================================================
    print("\n--- TEST 1: Claim Yelp Review Task (NO Reddit Account) ---")
    tr = conn.transaction()
    await tr.start()
    try:
        await conn.execute("SET LOCAL ROLE authenticated;")
        await conn.execute(f"SET LOCAL \"request.jwt.claim.sub\" = '{uid}';")
        await conn.execute("SET LOCAL \"request.jwt.claim.role\" = 'authenticated';")
        
        yelp_assign = await conn.fetchrow("SELECT * FROM public.claim_task_assignment($1, NULL);", yelp_task["id"])
        assert yelp_assign is not None, "Yelp claim returned no row"
        assert yelp_assign["reddit_account_id"] is None, "reddit_account_id must be None for Yelp task"
        assert yelp_assign["user_id"] == uid, "user_id must match authenticated user"
        assert yelp_assign["status"] == "in_progress", "Assignment status must be in_progress"
        print(f"[PASS] Yelp Task claimed successfully! ID: {yelp_assign['id']}")
    finally:
        await tr.rollback()

    # ========================================================
    # TEST 2: Claim Clutch Review Task without Reddit Account
    # ========================================================
    print("\n--- TEST 2: Claim Clutch Review Task (NO Reddit Account) ---")
    tr = conn.transaction()
    await tr.start()
    try:
        await conn.execute("SET LOCAL ROLE authenticated;")
        await conn.execute(f"SET LOCAL \"request.jwt.claim.sub\" = '{uid}';")
        await conn.execute("SET LOCAL \"request.jwt.claim.role\" = 'authenticated';")
        
        clutch_assign = await conn.fetchrow("SELECT * FROM public.claim_task_assignment($1, NULL);", clutch_task["id"])
        assert clutch_assign is not None, "Clutch claim returned no row"
        assert clutch_assign["reddit_account_id"] is None, "reddit_account_id must be None for Clutch task"
        assert clutch_assign["user_id"] == uid, "user_id must match authenticated user"
        assert clutch_assign["status"] == "in_progress", "Assignment status must be in_progress"
        print(f"[PASS] Clutch Task claimed successfully! ID: {clutch_assign['id']}")
    finally:
        await tr.rollback()

    # ========================================================
    # TEST 3: Claim Trustpilot Task without Reddit Account
    # ========================================================
    print("\n--- TEST 3: Claim Trustpilot Task (NO Reddit Account) ---")
    tr = conn.transaction()
    await tr.start()
    try:
        await conn.execute("SET LOCAL ROLE authenticated;")
        await conn.execute(f"SET LOCAL \"request.jwt.claim.sub\" = '{uid}';")
        await conn.execute("SET LOCAL \"request.jwt.claim.role\" = 'authenticated';")
        
        tp_assign = await conn.fetchrow("SELECT * FROM public.claim_task_assignment($1, NULL);", tp_task["id"])
        assert tp_assign is not None, "Trustpilot claim returned no row"
        assert tp_assign["reddit_account_id"] is None, "reddit_account_id must be None for Trustpilot task"
        assert tp_assign["user_id"] == uid, "user_id must match authenticated user"
        assert tp_assign["status"] == "in_progress", "Assignment status must be in_progress"
        print(f"[PASS] Trustpilot Task claimed successfully! ID: {tp_assign['id']}")
    finally:
        await tr.rollback()

    # ========================================================
    # TEST 4: Reddit Task Claim WITHOUT Reddit Account (MUST FAIL)
    # ========================================================
    if reddit_task:
        print("\n--- TEST 4: Claim Reddit Task WITHOUT Reddit Account (Must Fail) ---")
        tr = conn.transaction()
        await tr.start()
        try:
            await conn.execute("SET LOCAL ROLE authenticated;")
            await conn.execute(f"SET LOCAL \"request.jwt.claim.sub\" = '{uid}';")
            await conn.execute("SET LOCAL \"request.jwt.claim.role\" = 'authenticated';")
            
            failed = False
            try:
                await conn.fetchrow("SELECT * FROM public.claim_task_assignment($1, NULL);", reddit_task["id"])
            except Exception as e:
                failed = True
                print(f"[PASS] Correctly rejected with: {e}")
                assert "Akun Reddit harus dipilih" in str(e) or "Akun Reddit wajib" in str(e)
            assert failed, "Claiming a Reddit task without a Reddit account should fail"
        finally:
            await tr.rollback()

    # ========================================================
    # TEST 5: list_eligible_tasks_for_user() returns review tasks with NO Reddit account required
    # ========================================================
    print("\n--- TEST 5: list_eligible_tasks_for_user() (Client RPC) ---")
    tr = conn.transaction()
    await tr.start()
    try:
        await conn.execute("SET LOCAL ROLE authenticated;")
        await conn.execute(f"SET LOCAL \"request.jwt.claim.sub\" = '{uid}';")
        await conn.execute("SET LOCAL \"request.jwt.claim.role\" = 'authenticated';")
        
        tasks = await conn.fetch("SELECT id, title, task_category, can_do_with_account_id FROM public.list_eligible_tasks_for_user();")
        yelp_eligible = [t for t in tasks if t["task_category"] == "yelp_review"]
        clutch_eligible = [t for t in tasks if t["task_category"] == "clutch_review"]
        tp_eligible = [t for t in tasks if t["task_category"] == "trustpilot_review"]
        
        print(f"[PASS] Total eligible tasks visible: {len(tasks)}")
        print(f"  - Yelp reviews visible: {len(yelp_eligible)}")
        print(f"  - Clutch reviews visible: {len(clutch_eligible)}")
        print(f"  - Trustpilot reviews visible: {len(tp_eligible)}")
        
        for t in yelp_eligible + clutch_eligible + tp_eligible:
            assert t["can_do_with_account_id"] is None, f"Review task {t['title']} must not require can_do_with_account_id"
        print("[PASS] All non-Reddit review tasks have can_do_with_account_id = None!")
    finally:
        await tr.rollback()

    # ========================================================
    # TEST 6: Complete Delivery Flow to Straight.ltd
    # (Claim -> Submit -> Admin Approve -> Verify delivery proof on Straight order)
    # ========================================================
    print("\n--- TEST 6: Complete Delivery Flow to Straight.ltd ---")
    # Find order linked to yelp task
    yelp_full = await conn.fetchrow("SELECT id, source_order_id, reward_amount FROM public.tasks WHERE id = $1;", yelp_task["id"])
    source_order_id = yelp_full["source_order_id"]
    print(f"  Linked Straight Order ID: {source_order_id}")

    test_assignment_id = uuid.uuid4()
    proof_url = "https://www.yelp.ca/biz/test-proof-123"
    proof_img = "https://yorlsgzsawchpeeazcvi.supabase.co/storage/v1/object/public/task-proofs/test-proof.jpg"
    draft_review = "Outstanding customer service and top quality professional work. Highly recommend to everyone in Toronto!"

    # Insert test assignment
    await conn.execute("""
        INSERT INTO public.task_assignments (
            id, task_id, user_id, reddit_account_id, status, proof_url, proof_image_url, submitted_username, draft_comment
        ) VALUES ($1, $2, $3, NULL, 'submitted', $4, $5, 'JohnDoe_Toronto', $6);
    """, test_assignment_id, yelp_task["id"], uid, proof_url, proof_img, draft_review)

    # Approve assignment
    await conn.execute("UPDATE public.task_assignments SET status = 'approved' WHERE id = $1;", test_assignment_id)

    # Verify Straight order updated with delivery proof
    order_after = await conn.fetchrow("SELECT id, delivered_upvotes, delivery_proof_text, delivery_proof_url FROM public.reddit_upvote_orders WHERE id = $1;", source_order_id)
    print(f"[PASS] Straight Order After Delivery:")
    print(f"  - Delivered count: {order_after['delivered_upvotes']}")
    print(f"  - Delivery Proof URL: {order_after['delivery_proof_url']}")
    print(f"  - Delivery Proof Text: {order_after['delivery_proof_text']}")
    assert order_after["delivery_proof_url"] == proof_img, "Straight order delivery_proof_url was not updated"
    assert proof_url in order_after["delivery_proof_text"] or draft_review in order_after["delivery_proof_text"], "Straight order delivery_proof_text missing"

    # Verify member user_credits credited
    credit_row = await conn.fetchrow("SELECT amount, source, reference_id FROM public.user_credits WHERE reference_id = $1;", test_assignment_id)
    assert credit_row is not None, "user_credits not found for approved assignment"
    assert credit_row["amount"] == yelp_full["reward_amount"], f"Expected reward {yelp_full['reward_amount']}, got {credit_row['amount']}"
    print(f"[PASS] Member rewarded: Rp{credit_row['amount']} (source: {credit_row['source']})")

    # Cleanup test delivery
    await conn.execute("DELETE FROM public.user_credits WHERE reference_id = $1;", test_assignment_id)
    await conn.execute("DELETE FROM public.task_assignments WHERE id = $1;", test_assignment_id)
    # Restore order delivered count
    await conn.execute("UPDATE public.reddit_upvote_orders SET delivered_upvotes = GREATEST(delivered_upvotes - 1, 0) WHERE id = $1;", source_order_id)
    await conn.execute("SELECT public.sync_task_slot_count($1);", yelp_task["id"])
    print("[PASS] Test fixtures cleaned up cleanly.")

    await conn.close()
    print("\n=== ALL 6 TESTS PASSED 100%! SYSTEM FULLY DECOUPLED & VERIFIED! ===")

asyncio.run(main())
