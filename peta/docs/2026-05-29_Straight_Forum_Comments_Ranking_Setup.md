# Straight Ltd Forum Comments + Ranking Forum Page Setup

## What shipped locally

- `/reddit/new-order?service=comments` opens the active Forum Comments order flow.
- Clients can submit any public discussion URL, not only Reddit.
- Standard comment order costs `$5.00`.
- Suggested comment assistant costs `$5.50` (+10%).
- Suggested flow asks for brand/domain and plain-text vs link mention.
- Suggested draft appears in the textarea and can be edited or refreshed; clients do not see the internal model/provider.
- `/reddit/ranking-forum` is a step-by-step discovery flow: seed keyword -> paginated keyword ideas -> forum URL selection -> bulk order review.
- The keyword step can return many keyword ideas and displays 25 keywords per page with next/previous pagination.
- Clients can select multiple keywords, then select multiple forum URLs from the scanned Google top-10 results.
- The results panel only shows forum/discussion URLs found in each Google top-10 scan. Non-forum Google results are hidden; keywords with no forum URL are labeled as no forum.
- The selected forum URL queue is checked against available credit before continuing into bulk order checkout.
- The Ranking Forum draft is persisted in `localStorage`, so refresh/backtracking returns clients to the step where they left off.
- Comment orders are stored in `reddit_upvote_orders` with `target_type='comment'`; details are stored as JSON text in `notes`.

## Required Supabase migration

Link the target project first, then apply:

```bash
supabase link --project-ref <project-ref>
supabase db push
```

Migration file:

```text
supabase/migrations/20260529143000_forum_comment_orders.sql
```

This adds `fn_create_forum_comment_order(...)`, which deducts credits server-side and creates a comment order atomically.

## Required Edge Functions

Deploy both:

```bash
supabase functions deploy generate-forum-comment --project-ref <project-ref>
supabase functions deploy rank-forum-pages --project-ref <project-ref>
```

Both functions are configured in `supabase/config.toml` with `verify_jwt = true`.
They are intended to be called only by logged-in Straight Ltd users through the Supabase client.

Use staging first:

```text
duxzxizedtvnopfihllz
```

Then production:

```text
yorlsgzsawchpeeazcvi
```

`supabase db push` does not accept `--project-ref`; switch projects with `supabase link --project-ref ...` before each environment.

## Required secrets

For suggested comments:

```bash
supabase secrets set DEEPSEEK_API_KEY="<deepseek-api-key>" --project-ref <project-ref>
```

Optional:

```bash
supabase secrets set DEEPSEEK_MODEL="deepseek-chat" --project-ref <project-ref>
```

For live keyword volume and Google Organic top-10 SERP via DataForSEO:

```bash
supabase secrets set DATAFORSEO_LOGIN="<dataforseo-login>" --project-ref <project-ref>
supabase secrets set DATAFORSEO_PASSWORD="<dataforseo-api-password>" --project-ref <project-ref>
```

Optional Google Custom Search fallback:

```bash
supabase secrets set GOOGLE_SEARCH_API_KEY="<google-custom-search-api-key>" --project-ref <project-ref>
supabase secrets set GOOGLE_SEARCH_CX="<google-custom-search-engine-id>" --project-ref <project-ref>
```

If DataForSEO and Google fallback secrets are missing or temporarily unavailable, Ranking Forum Page falls back to a local preview so the UX still works, but it is not live SERP data.

## Frontend deployment

The current hosting target is Cloudflare Pages project `peta` under account `99dd60debc042e9b615dd44472645e71`.
Build and deploy manually; GitHub push does not auto-deploy this project.

```bash
npm run build
npx wrangler pages deploy dist --project-name=peta --branch=main --commit-dirty=true
```

Before deploying production, confirm the built bundle points at prod Supabase:

```bash
rg -o "yorlsgzsawchpeeazcvi|duxzxizedtvnopfihllz" dist/assets
```

Expected production output contains `yorlsgzsawchpeeazcvi` and does not contain `duxzxizedtvnopfihllz`.

## QA checklist

1. Log in as a Straight Ltd client.
2. Open `/reddit/new-order?service=comments`.
3. Paste a HubSpot/Quora/Reddit/forum URL.
4. Choose suggested comment.
5. Enter brand/domain.
6. Toggle plain text vs link.
7. Generate comment with DeepSeek.
8. Edit the textarea manually.
9. Regenerate once.
10. Place order and confirm `$5.50` is deducted.
11. Open `/reddit/orders` and confirm it shows Comment, not Upvotes.
12. Open order detail and confirm final comment is visible.
13. Open `/reddit/admin/orders` and confirm admin can see final comment, brand, mention mode, and mark order completed.
14. Open `/reddit/ranking-forum`, enter a seed topic, confirm keyword suggestions are paginated 25 per page, select multiple keywords, scan them, select multiple forum URLs, refresh the page, and confirm it restores the previous step.
15. Continue from the Ranking Forum review step into `/reddit/new-order?service=comments&bulk=ranking-forum`, confirm the bulk queue appears, and confirm credit gating blocks checkout when balance is insufficient.

## Notes

- The `forum-comment` skill rules are encoded in the `generate-forum-comment` prompt: one brand mention, no hard sell, no em dash, platform-native style, helpful recommendation tone.
- The user's Edge browser DeepSeek login is not used by production code. Production needs a server-side `DEEPSEEK_API_KEY` secret so clients can generate comments reliably without touching the user's browser session.
