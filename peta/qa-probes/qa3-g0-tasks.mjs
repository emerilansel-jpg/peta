// QA3 Gate 0 — Phase 1: admin creates QA3 test tasks (forum/reddit_comment/upvote)
import { signIn, rpc, save, ADMIN_EMAIL, ADMIN_PWD, TS } from './qa3-lib.mjs';

const a = await signIn(ADMIN_EMAIL, ADMIN_PWD);
if (!a.access_token) { console.error('ADMIN LOGIN FAILED', a.error); process.exit(1); }
const jwt = a.access_token;

const out = {};
const tasks = [
  {
    tag: 'forum', p_title: `QA3 Forum Task ${TS}`, p_description: 'QA3: komentar di forum (bisa dikerjakan tanpa akun Reddit).',
    p_brief: 'Tulis komentar ramah di thread forum tentang produk X.',
    p_target_url: 'https://community.hubspot.com/t5/Forums/ct-p/Forums',
    p_task_category: 'forum_comment', p_reward_amount: 5000, p_max_assignments: 3,
    p_per_account_limit: 1, p_min_karma: 0, p_min_account_age_days: 0,
    p_start_at: null, p_end_at: null, p_post_to_wa_group: false, p_wa_group_draft: null, p_status: 'active',
  },
  {
    tag: 'reddit_comment', p_title: `QA3 Reddit Comment ${TS}`, p_description: 'QA3: komentar di Reddit (butuh akun Reddit terhubung).',
    p_brief: 'Tulis komentar bermanfaat di thread r/indonesia.',
    p_target_url: 'https://reddit.com/r/indonesia/comments/qa3',
    p_task_category: 'reddit_comment', p_reward_amount: 8000, p_max_assignments: 3,
    p_per_account_limit: 1, p_min_karma: 0, p_min_account_age_days: 0,
    p_start_at: null, p_end_at: null, p_post_to_wa_group: false, p_wa_group_draft: null, p_status: 'active',
  },
  {
    tag: 'upvote', p_title: `QA3 Upvote Task ${TS}`, p_description: 'QA3: upvote post.',
    p_brief: 'Upvote post di Reddit.',
    p_target_url: 'https://reddit.com/r/indonesia/comments/qa3up',
    p_task_category: 'reddit_upvote', p_reward_amount: 500, p_max_assignments: 3,
    p_per_account_limit: 1, p_min_karma: 0, p_min_account_age_days: 0,
    p_start_at: null, p_end_at: null, p_post_to_wa_group: false, p_wa_group_draft: null, p_status: 'active',
  },
  {
    tag: 'forum_high', p_title: `QA3 Forum High ${TS}`, p_description: 'QA3: komentar forum reward tinggi (bantu uji eligibility payout).',
    p_brief: 'Tulis review jujur di forum.',
    p_target_url: 'https://community.hubspot.com/t5/Forums/ct-p/Forums',
    p_task_category: 'forum_comment', p_reward_amount: 15000, p_max_assignments: 3,
    p_per_account_limit: 1, p_min_karma: 0, p_min_account_age_days: 0,
    p_start_at: null, p_end_at: null, p_post_to_wa_group: false, p_wa_group_draft: null, p_status: 'active',
  },
];

for (const t of tasks) {
  const { tag, ...rpcArgs } = t;
  const r = await rpc('admin_create_task', rpcArgs, jwt);
  out[tag] = { status: r.status, body: r.body };
}
save('qa3-g0-create-tasks.json', out);
console.log(JSON.stringify(out, null, 2));
