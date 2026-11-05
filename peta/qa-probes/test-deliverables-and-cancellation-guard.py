import asyncio
import asyncpg
import uuid

DB_URL = "postgresql://postgres.yorlsgzsawchpeeazcvi:1LspZOMMM4zi2eWD@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres"

async def main():
    print("=== TEST SUITE: ORDER DELIVERABLES, ANTI-FRAUD HASH & CANCELLATION GUARD ===")
    conn = await asyncpg.connect(DB_URL)

    # 1. Fetch army users and a client user
    army_users = await conn.fetch("SELECT id, email FROM public.users WHERE role = 'army' AND is_active = true LIMIT 3;")
    client_user = await conn.fetchrow("SELECT id, email, credit_balance FROM public.users WHERE role = 'client' AND is_active = true LIMIT 1;")
    if not client_user:
        client_user = await conn.fetchrow("SELECT id, email, credit_balance FROM public.users WHERE is_active = true LIMIT 1;")

    army1_id = army_users[0]["id"]
    army2_id = army_users[1]["id"]
    client_id = client_user["id"]
    print(f"[SETUP] Army User 1: {army_users[0]['email']} ({army1_id})")
    print(f"[SETUP] Army User 2: {army_users[1]['email']} ({army2_id})")
    print(f"[SETUP] Client User: {client_user['email']} ({client_id})")

    # ========================================================
    # TEST 1: Multiple Deliverables Relational Storage (No Overwrite!)
    # ========================================================
    print("\n--- TEST 1: Multiple Deliverables Relational Storage ---")
    tr = conn.transaction()
    await tr.start()
    try:
        # Create a test client order for 2 reviews ($200)
        order_id = await conn.fetchval("""
            INSERT INTO public.reddit_upvote_orders (
                user_id, target_type, thread_url, requested_upvotes, delivered_upvotes,
                cost_credits, status, notes
            ) VALUES (
                $1, 'yelp_review', 'https://www.yelp.com/biz/test-relational-deliverables', 2, 0,
                20000, 'processing', 'QA Deliverables Test'
            ) RETURNING id;
        """, client_id)
        print(f"  Created test order #{order_id}")

        # Task created for this order
        task_id = await conn.fetchval("""
            INSERT INTO public.tasks (
                title, description, target_url, task_type, task_category,
                reward_amount, max_assignments, current_assignments, status, source_order_id
            ) VALUES (
                'Review Yelp Test', 'Test description', 'https://www.yelp.com/biz/test-relational-deliverables',
                'comment', 'yelp_review', 5000, 2, 0, 'active', $1
            ) RETURNING id;
        """, order_id)

        # Assignment 1: Reviewer A (Army 1)
        assign1_id = uuid.uuid4()
        await conn.execute("""
            INSERT INTO public.task_assignments (
                id, task_id, user_id, status, submitted_username, submitted_url, proof_image_url
            ) VALUES (
                $1, $2, $3, 'submitted', 'Alex_Miller_CA', 'https://www.yelp.com/user_details?userid=alex',
                'https://storage.supabase.co/proof1.jpg'
            );
        """, assign1_id, task_id, army1_id)

        # Approve Assignment 1
        await conn.execute("UPDATE public.task_assignments SET status = 'approved' WHERE id = $1;", assign1_id)

        # Assignment 2: Reviewer B (Army 2)
        assign2_id = uuid.uuid4()
        await conn.execute("""
            INSERT INTO public.task_assignments (
                id, task_id, user_id, status, submitted_username, submitted_url, proof_image_url
            ) VALUES (
                $1, $2, $3, 'submitted', 'Sarah_Jenkins_NY', 'https://www.yelp.com/user_details?userid=sarah',
                'https://storage.supabase.co/proof2.jpg'
            );
        """, assign2_id, task_id, army2_id)

        # Approve Assignment 2
        await conn.execute("UPDATE public.task_assignments SET status = 'approved' WHERE id = $1;", assign2_id)

        # Verify relational order_deliverables has BOTH items preserved!
        deliverables = await conn.fetch("""
            SELECT item_index, reviewer_name, proof_url, screenshot_url, status
            FROM public.order_deliverables
            WHERE order_id = $1
            ORDER BY item_index ASC;
        """, order_id)

        assert len(deliverables) == 2, f"Expected 2 deliverables, got {len(deliverables)}"
        assert deliverables[0]["reviewer_name"] == "Alex_Miller_CA", "Deliverable 1 reviewer mismatch"
        assert deliverables[0]["screenshot_url"] == "https://storage.supabase.co/proof1.jpg", "Screenshot 1 overwritten!"
        assert deliverables[1]["reviewer_name"] == "Sarah_Jenkins_NY", "Deliverable 2 reviewer mismatch"
        assert deliverables[1]["screenshot_url"] == "https://storage.supabase.co/proof2.jpg", "Screenshot 2 mismatch"
        print(f"[PASS] Successfully stored 2 distinct deliverables in order_deliverables:")
        print(f"  - Item #{deliverables[0]['item_index']}: {deliverables[0]['reviewer_name']} ({deliverables[0]['screenshot_url']})")
        print(f"  - Item #{deliverables[1]['item_index']}: {deliverables[1]['reviewer_name']} ({deliverables[1]['screenshot_url']})")

        # Verify client RPC fn_get_order_delivery_proofs
        await conn.execute("SET LOCAL ROLE authenticated;")
        await conn.execute(f"SET LOCAL \"request.jwt.claim.sub\" = '{client_id}';")
        await conn.execute("SET LOCAL \"request.jwt.claim.role\" = 'authenticated';")

        rpc_proofs = await conn.fetch("SELECT * FROM public.fn_get_order_delivery_proofs($1);", order_id)
        assert len(rpc_proofs) == 2, f"Expected 2 proofs from RPC, got {len(rpc_proofs)}"
        print(f"[PASS] Client RPC fn_get_order_delivery_proofs returned {len(rpc_proofs)} verified items!")
    finally:
        await tr.rollback()
        print("  [Cleaned up Test 1 transaction]")

    # ========================================================
    # TEST 2: Anti-Fraud Duplicate Screenshot Hash Rejection
    # ========================================================
    print("\n--- TEST 2: Anti-Fraud Duplicate Screenshot Hash Rejection ---")
    tr = conn.transaction()
    await tr.start()
    try:
        task2_id = await conn.fetchval("""
            INSERT INTO public.tasks (
                title, description, target_url, task_type, task_category,
                reward_amount, max_assignments, current_assignments, status
            ) VALUES (
                'Review Yelp Test 2', 'Desc', 'https://www.yelp.com/biz/test-fraud',
                'comment', 'yelp_review', 5000, 2, 0, 'active'
            ) RETURNING id;
        """)

        duplicate_hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

        # Assignment 1 submits with this hash
        assign_a = uuid.uuid4()
        await conn.execute("""
            INSERT INTO public.task_assignments (
                id, task_id, user_id, status, proof_image_hash, proof_image_url
            ) VALUES ($1, $2, $3, 'submitted', $4, 'https://storage/img1.png');
        """, assign_a, task2_id, army1_id, duplicate_hash)
        print(f"  First assignment submitted by Army 1 with SHA-256: {duplicate_hash[:16]}...")

        # Assignment 2 (Army 2) attempts to submit with the EXACT SAME HASH
        assign_b = uuid.uuid4()
        duplicate_rejected = False
        try:
            await conn.execute("""
                INSERT INTO public.task_assignments (
                    id, task_id, user_id, status, proof_image_hash, proof_image_url
                ) VALUES ($1, $2, $3, 'submitted', $4, 'https://storage/img2.png');
            """, assign_b, task2_id, army2_id, duplicate_hash)
        except Exception as e:
            duplicate_rejected = True
            print(f"[PASS] Duplicate screenshot correctly rejected with: {e}")
            assert "Screenshot ini sudah pernah digunakan" in str(e)

        assert duplicate_rejected, "System failed to reject duplicate screenshot hash!"
    finally:
        await tr.rollback()
        print("  [Cleaned up Test 2 transaction]")

    # ========================================================
    # TEST 3: Cancellation Lock Guard & Partial Refund
    # ========================================================
    print("\n--- TEST 3: Cancellation Lock Guard & Partial Refund ---")
    tr = conn.transaction()
    await tr.start()
    try:
        # Order for 3 units ($300.00 / 30000 credits)
        order3_id = await conn.fetchval("""
            INSERT INTO public.reddit_upvote_orders (
                user_id, target_type, thread_url, requested_upvotes, delivered_upvotes,
                cost_credits, status
            ) VALUES (
                $1, 'yelp_review', 'https://www.yelp.com/biz/test-cancel-guard', 3, 1,
                30000, 'processing'
            ) RETURNING id;
        """, client_id)

        # Task is automatically generated by database trigger
        task3_id = await conn.fetchval("SELECT id FROM public.tasks WHERE source_order_id = $1;", order3_id)

        # 1 unit already delivered (delivered_upvotes = 1)
        # 1 unit currently in_progress by an army worker
        assign_active = uuid.uuid4()
        await conn.execute("""
            INSERT INTO public.task_assignments (
                id, task_id, user_id, status
            ) VALUES ($1, $2, $3, 'in_progress');
        """, assign_active, task3_id, army1_id)

        # Simulate initial credit deduction
        await conn.execute(f"""
            INSERT INTO public.credit_transactions (
                user_id, type, amount, balance_after, metadata
            ) VALUES (
                '{client_id}', 'spend', -30000, 50000, '{{"reddit_upvote_order_id": "{order3_id}"}}'::jsonb
            );
        """)

        # Check cancellation preview RPC as authenticated client
        await conn.execute("SET LOCAL ROLE authenticated;")
        await conn.execute(f"SET LOCAL \"request.jwt.claim.sub\" = '{client_id}';")
        await conn.execute("SET LOCAL \"request.jwt.claim.role\" = 'authenticated';")

        preview = await conn.fetchval("SELECT public.get_order_cancellation_preview($1);", order3_id)
        import json
        p_data = json.loads(preview) if isinstance(preview, str) else preview
        print(f"  Preview Calculation: requested={p_data['requested_units']}, delivered={p_data['delivered_units']}, locked={p_data['locked_active_units']}, refundable={p_data['refundable_units']}, refund_amount={p_data['refund_amount']}")
        assert p_data["refundable_units"] == 1, f"Expected 1 refundable unit, got {p_data['refundable_units']}"
        assert p_data["refund_amount"] == 10000, f"Expected 10000 refund amount, got {p_data['refund_amount']}"
        assert p_data["can_cancel"] is True, "Order should still be cancelable for partial refund"
        print("[PASS] Cancellation preview accurately calculates partial refundable units!")

        # Execute cancellation via secure client RPC
        await conn.execute("SELECT public.fn_client_cancel_order($1, 'Client decided to change campaign');", order3_id)

        # Reset role to inspect DB transactions
        await conn.execute("RESET ROLE;")

        # Verify refund transaction
        refund_tx = await conn.fetchrow("""
            SELECT amount, metadata FROM public.credit_transactions
            WHERE user_id = $1 AND type = 'refund' AND metadata->>'reddit_upvote_order_id' = $2;
        """, client_id, str(order3_id))

        assert refund_tx is not None, "Refund transaction was not created"
        assert refund_tx["amount"] == 10000, f"Expected refund 10000, got {refund_tx['amount']}"
        print(f"[PASS] Client correctly received partial refund of {refund_tx['amount']} credits (1 uncommitted unit)!")

        # Verify order cancel_reason note
        order3_after = await conn.fetchrow("SELECT cancel_reason FROM public.reddit_upvote_orders WHERE id = $1;", order3_id)
        print(f"  Cancel reason record: {order3_after['cancel_reason']}")
        assert "Refund: 1 dari 3 unit. 2 unit terkunci" in order3_after["cancel_reason"]

        # SUBTEST 3B: If all units are committed (e.g. 1 of 1 locked/delivered), CANCEL MUST BE BLOCKED
        order4_id = await conn.fetchval("""
            INSERT INTO public.reddit_upvote_orders (
                user_id, target_type, thread_url, requested_upvotes, delivered_upvotes,
                cost_credits, status
            ) VALUES (
                $1, 'yelp_review', 'https://www.yelp.com/biz/test-cancel-blocked', 1, 0,
                10000, 'processing'
            ) RETURNING id;
        """, client_id)

        task4_id = await conn.fetchval("SELECT id FROM public.tasks WHERE source_order_id = $1;", order4_id)

        # Army is actively working on it (1 requested, 1 in_progress)
        await conn.execute("""
            INSERT INTO public.task_assignments (
                id, task_id, user_id, status
            ) VALUES ($1, $2, $3, 'in_progress');
        """, uuid.uuid4(), task4_id, army1_id)

        await conn.execute(f"""
            INSERT INTO public.credit_transactions (
                user_id, type, amount, balance_after, metadata
            ) VALUES (
                '{client_id}', 'spend', -10000, 40000, '{{"reddit_upvote_order_id": "{order4_id}"}}'::jsonb
            );
        """)

        await conn.execute("SET LOCAL ROLE authenticated;")
        await conn.execute(f"SET LOCAL \"request.jwt.claim.sub\" = '{client_id}';")
        await conn.execute("SET LOCAL \"request.jwt.claim.role\" = 'authenticated';")

        all_locked_rejected = False
        try:
            await conn.execute("SELECT public.fn_client_cancel_order($1, 'Test cancel');", order4_id)
        except Exception as e:
            all_locked_rejected = True
            print(f"[PASS] Cancel blocked when all units are committed: {e}")
            assert "Semua slot pesanan sedang dikerjakan" in str(e)

        assert all_locked_rejected, "Cancellation should have been blocked when all units are actively committed!"
    finally:
        await tr.rollback()
        print("  [Cleaned up Test 3 transaction]")

    await conn.close()
    print("\n=== ALL QA AUDIT PROBE TESTS PASSED 100%! SYSTEM IS PRODUCTION-READY! ===")

asyncio.run(main())
