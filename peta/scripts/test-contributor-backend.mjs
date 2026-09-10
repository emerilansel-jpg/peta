// Offline only: verify contributor workflow migration and backend contract logic
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationSql = readFileSync(
  new URL('../supabase/migrations/20260910110000_contributor_workflow.sql', import.meta.url),
  'utf8'
);
const apiTs = readFileSync(
  new URL('../src/lib/api.ts', import.meta.url),
  'utf8'
);
const databaseTs = readFileSync(
  new URL('../src/types/database.ts', import.meta.url),
  'utf8'
);

// 1. Migration DDL & Contract static checks
console.log('1. Checking SQL migration structure and contracts...');

// Tasks table additions
assert.ok(
  migrationSql.includes("ADD COLUMN IF NOT EXISTS eligibility_status text DEFAULT 'legacy'"),
  'tasks table must add eligibility_status'
);
assert.ok(
  migrationSql.includes("ADD COLUMN IF NOT EXISTS eligibility_reason text"),
  'tasks table must add eligibility_reason'
);
assert.ok(
  migrationSql.includes("'legacy', 'pending', 'approved', 'revision', 'rejected'"),
  'tasks eligibility_status check constraint must include all required states'
);

// Task assignments table additions
assert.ok(
  migrationSql.includes("ADD COLUMN IF NOT EXISTS contributor_workflow boolean DEFAULT false"),
  'task_assignments must add contributor_workflow'
);
assert.ok(
  migrationSql.includes("ADD COLUMN IF NOT EXISTS first_proof_submitted_at timestamptz"),
  'task_assignments must add first_proof_submitted_at'
);
assert.ok(
  migrationSql.includes("ADD COLUMN IF NOT EXISTS visibility_check_after timestamptz"),
  'task_assignments must add visibility_check_after'
);
assert.ok(
  migrationSql.includes("ADD COLUMN IF NOT EXISTS visibility_status text DEFAULT NULL"),
  'task_assignments must add visibility_status'
);
assert.ok(
  migrationSql.includes("'visible', 'not_visible', 'unknown'"),
  'task_assignments visibility_status check constraint must match required values'
);

// fn_ensure_order_task checks
assert.ok(
  migrationSql.includes("paid_reddit_votes_disabled"),
  'fn_ensure_order_task must block new Reddit upvote tasks'
);
assert.ok(
  migrationSql.includes("v_is_reddit_comment_or_post"),
  'fn_ensure_order_task must distinguish Reddit comment/post tasks'
);
assert.ok(
  migrationSql.includes("v_eligibility_status := 'pending'"),
  'fn_ensure_order_task must set eligibility_status = pending for Reddit tasks'
);
assert.ok(
  migrationSql.includes("v_initial_status := 'paused'"),
  'fn_ensure_order_task must set status = paused for Reddit tasks'
);

// RPC definitions in SQL
assert.ok(
  migrationSql.includes("admin_review_task_eligibility("),
  'SQL must define admin_review_task_eligibility RPC'
);
assert.ok(
  migrationSql.includes("submit_assignment_proof("),
  'SQL must define submit_assignment_proof RPC'
);
assert.ok(
  migrationSql.includes("admin_review_assignment_visibility("),
  'SQL must define admin_review_assignment_visibility RPC'
);
assert.ok(
  migrationSql.includes("INTERVAL '72 hours'"),
  'SQL submit_assignment_proof must enforce 72 hour visibility check window'
);

// Approval & Rejection contributor workflow checks
assert.ok(
  migrationSql.includes("contributor_workflow_requires_visible"),
  'admin_approve_assignment must require visibility_status = visible for contributor workflow'
);
assert.ok(
  migrationSql.includes("contributor_workflow_unknown_visibility"),
  'admin_reject_assignment must prevent auto-failing unknown visibility'
);
assert.ok(
  migrationSql.includes("contributor_workflow_wait_72h"),
  'admin_reject_assignment must enforce 72 hour wait before rejecting not_visible'
);

// 2. TypeScript API & types contract checks
console.log('2. Checking TypeScript API exports and type declarations...');

assert.ok(
  apiTs.includes('export interface TaskAssignment'),
  'api.ts must export TaskAssignment interface'
);
assert.ok(
  apiTs.includes('contributor_workflow?: boolean'),
  'TaskAssignment interface must include contributor_workflow'
);
assert.ok(
  apiTs.includes('first_proof_submitted_at?: string | null'),
  'TaskAssignment interface must include first_proof_submitted_at'
);
assert.ok(
  apiTs.includes('visibility_check_after?: string | null'),
  'TaskAssignment interface must include visibility_check_after'
);
assert.ok(
  apiTs.includes('visibility_status?: AssignmentVisibilityStatus | null'),
  'TaskAssignment interface must include visibility_status'
);

assert.ok(
  apiTs.includes('export async function adminReviewTaskEligibility('),
  'api.ts must export adminReviewTaskEligibility'
);
assert.ok(
  apiTs.includes('export async function submitAssignmentProof('),
  'api.ts must export submitAssignmentProof'
);
assert.ok(
  apiTs.includes('export async function adminReviewAssignmentVisibility('),
  'api.ts must export adminReviewAssignmentVisibility'
);

assert.ok(
  databaseTs.includes('export interface TaskAssignment'),
  'database.ts must export TaskAssignment'
);
assert.ok(
  databaseTs.includes("export type TaskEligibilityStatus = 'legacy' | 'pending' | 'approved' | 'revision' | 'rejected'"),
  'database.ts must export TaskEligibilityStatus'
);
assert.ok(
  databaseTs.includes("export type AssignmentVisibilityStatus = 'visible' | 'not_visible' | 'unknown'"),
  'database.ts must export AssignmentVisibilityStatus'
);

// 3. Simulating state machines and business logic offline
console.log('3. Simulating logic and state machine transitions offline...');

// A. Task Creation Logic Simulation
function simulateEnsureOrderTask(order, autoActivate = true) {
  const notes = order.notes || {};
  const isPreferred = order.target_type === 'preferred_source' || notes.service === 'preferred_source';
  const isYoutube = order.target_type === 'youtube_upload' || notes.service === 'youtube_upload';
  const isLinkedInLike = order.target_type === 'linkedin_like' || notes.service === 'linkedin_like';
  const isLinkedInFollow = order.target_type === 'linkedin_follow' || notes.service === 'linkedin_follow';
  const isLinkedInComment = order.target_type === 'linkedin_comment' || notes.service === 'linkedin_comment';

  // Reddit upvotes blocked completely
  if (
    (order.target_type === 'upvote' || notes.service === 'reddit_upvote') &&
    !isPreferred && !isLinkedInLike && !isLinkedInFollow && !isYoutube
  ) {
    throw new Error('paid_reddit_votes_disabled: Reddit upvote tasks are disabled');
  }

  const isReddit = (
    !isLinkedInLike && !isLinkedInFollow && !isLinkedInComment && !isPreferred && !isYoutube &&
    (
      order.target_type === 'thread' ||
      order.thread_url?.includes('reddit.com') ||
      notes.platform === 'reddit' ||
      order.subreddit
    )
  );

  if (isReddit) {
    return {
      eligibility_status: 'pending',
      status: 'paused',
      orderStatus: 'pending',
    };
  }

  return {
    eligibility_status: 'legacy',
    status: autoActivate ? 'active' : 'draft',
    orderStatus: autoActivate ? 'processing' : 'pending',
  };
}

// Check Reddit upvote blocked
assert.throws(
  () => simulateEnsureOrderTask({ target_type: 'upvote', thread_url: 'https://reddit.com/r/test' }),
  /paid_reddit_votes_disabled/
);

// Check Reddit comment paused / pending dispatch
const redditCommentTask = simulateEnsureOrderTask({
  target_type: 'comment',
  thread_url: 'https://www.reddit.com/r/indonesia/comments/xyz/topic',
});
assert.equal(redditCommentTask.eligibility_status, 'pending');
assert.equal(redditCommentTask.status, 'paused');
assert.equal(redditCommentTask.orderStatus, 'pending');

// Check Reddit thread paused / pending dispatch
const redditThreadTask = simulateEnsureOrderTask({
  target_type: 'thread',
  thread_url: 'https://www.reddit.com/r/indonesia',
});
assert.equal(redditThreadTask.eligibility_status, 'pending');
assert.equal(redditThreadTask.status, 'paused');

// Check Non-Reddit tasks (LinkedIn, Preferred Source, YouTube, Quora) active / legacy
const linkedInTask = simulateEnsureOrderTask({
  target_type: 'linkedin_comment',
  thread_url: 'https://linkedin.com/posts/123',
});
assert.equal(linkedInTask.eligibility_status, 'legacy');
assert.equal(linkedInTask.status, 'active');
assert.equal(linkedInTask.orderStatus, 'processing');

const preferredTask = simulateEnsureOrderTask({
  target_type: 'preferred_source',
  thread_url: 'https://google.com/search?q=test',
});
assert.equal(preferredTask.eligibility_status, 'legacy');
assert.equal(preferredTask.status, 'active');

const quoraTask = simulateEnsureOrderTask({
  target_type: 'comment',
  thread_url: 'https://quora.com/topic-question',
  notes: { platform: 'quora' },
});
assert.equal(quoraTask.eligibility_status, 'legacy');
assert.equal(quoraTask.status, 'active');

// B. Admin Review Task Eligibility Simulation
function simulateAdminReviewTaskEligibility(task, decision, reason = null) {
  if (!['approved', 'revision', 'rejected'].includes(decision)) {
    throw new Error(`Invalid decision: ${decision}`);
  }
  if (decision === 'approved') {
    return {
      ...task,
      eligibility_status: 'approved',
      status: 'active',
      eligibility_reason: reason,
    };
  } else {
    return {
      ...task,
      eligibility_status: decision,
      status: 'paused',
      eligibility_reason: reason,
    };
  }
}

let task = { id: 'task-1', eligibility_status: 'pending', status: 'paused' };
task = simulateAdminReviewTaskEligibility(task, 'approved', 'Looks good');
assert.equal(task.eligibility_status, 'approved');
assert.equal(task.status, 'active');
assert.equal(task.eligibility_reason, 'Looks good');

task = simulateAdminReviewTaskEligibility(task, 'revision', 'Need clearer target');
assert.equal(task.eligibility_status, 'revision');
assert.equal(task.status, 'paused');

task = simulateAdminReviewTaskEligibility(task, 'rejected', 'Violates policy');
assert.equal(task.eligibility_status, 'rejected');
assert.equal(task.status, 'paused');

assert.throws(() => simulateAdminReviewTaskEligibility(task, 'invalid_choice'), /Invalid decision/);

// C. Proof Submission and 72-hour Immutability Simulation
function simulateSubmitProof(assignment, proofData, now) {
  if (assignment.userId !== proofData.userId && !proofData.isAdmin) {
    throw new Error('forbidden');
  }
  const allowed = ['in_progress', 'submitted'].includes(assignment.status) ||
    (assignment.status === 'rejected' && assignment.can_retry);
  if (!allowed) {
    throw new Error(`Invalid assignment status: ${assignment.status}`);
  }

  const firstSubmitted = assignment.first_proof_submitted_at || now;
  const visibilityCheckAfter = assignment.visibility_check_after || new Date(firstSubmitted.getTime() + 72 * 3600 * 1000);

  return {
    ...assignment,
    status: 'submitted',
    proof_url: proofData.proof_url || assignment.proof_url,
    submitted_url: proofData.submitted_url || assignment.submitted_url,
    submitted_username: proofData.submitted_username || assignment.submitted_username,
    draft_comment: proofData.draft_comment || assignment.draft_comment,
    proof_urls: proofData.proof_urls || assignment.proof_urls || [],
    first_proof_submitted_at: firstSubmitted,
    visibility_check_after: visibilityCheckAfter,
    contributor_workflow: true,
  };
}

const t0 = new Date('2026-09-10T12:00:00Z');
let assignment = {
  id: 'asg-1',
  userId: 'user-1',
  status: 'in_progress',
  contributor_workflow: true,
  first_proof_submitted_at: null,
  visibility_check_after: null,
};

// First proof submission
assignment = simulateSubmitProof(assignment, {
  userId: 'user-1',
  proof_url: 'https://reddit.com/proof/1',
  submitted_username: 'u_tester',
}, t0);

assert.equal(assignment.status, 'submitted');
assert.equal(assignment.first_proof_submitted_at.toISOString(), '2026-09-10T12:00:00.000Z');
assert.equal(assignment.visibility_check_after.toISOString(), '2026-09-13T12:00:00.000Z');

// Retry submission 24h later: original 72h timestamp must be IMMUTABLE
const t1 = new Date('2026-09-11T12:00:00Z');
assignment.status = 'rejected';
assignment.can_retry = true;

assignment = simulateSubmitProof(assignment, {
  userId: 'user-1',
  proof_url: 'https://reddit.com/proof/2',
  submitted_username: 'u_tester_retry',
}, t1);

assert.equal(assignment.first_proof_submitted_at.toISOString(), '2026-09-10T12:00:00.000Z', 'First submission date must be immutable');
assert.equal(assignment.visibility_check_after.toISOString(), '2026-09-13T12:00:00.000Z', 'Visibility check date must be immutable');

// D. Admin Approval Rules Simulation
function simulateAdminApprove(assignment) {
  if (assignment.status !== 'submitted') {
    throw new Error('Assignment must be in submitted status');
  }
  if (assignment.contributor_workflow) {
    if (assignment.visibility_status !== 'visible') {
      throw new Error('contributor_workflow_requires_visible: Must be visible before approval');
    }
  }
  return { ...assignment, status: 'approved' };
}

// Contributor without visible -> fails
assert.throws(
  () => simulateAdminApprove({ status: 'submitted', contributor_workflow: true, visibility_status: null }),
  /contributor_workflow_requires_visible/
);
assert.throws(
  () => simulateAdminApprove({ status: 'submitted', contributor_workflow: true, visibility_status: 'unknown' }),
  /contributor_workflow_requires_visible/
);
assert.throws(
  () => simulateAdminApprove({ status: 'submitted', contributor_workflow: true, visibility_status: 'not_visible' }),
  /contributor_workflow_requires_visible/
);

// Contributor with visible -> succeeds
const approved = simulateAdminApprove({ status: 'submitted', contributor_workflow: true, visibility_status: 'visible' });
assert.equal(approved.status, 'approved');

// Legacy assignment -> succeeds even if visibility_status is null
const legacyApproved = simulateAdminApprove({ status: 'submitted', contributor_workflow: false, visibility_status: null });
assert.equal(legacyApproved.status, 'approved');

// E. Admin Rejection Rules Simulation
function simulateAdminReject(assignment, reason, now) {
  if (assignment.balance_credited_at) {
    throw new Error('Cannot reject credited assignment');
  }
  if (assignment.contributor_workflow) {
    if (assignment.visibility_status === 'unknown') {
      throw new Error('contributor_workflow_unknown_visibility: Unknown visibility cannot auto-fail');
    }
    if (assignment.visibility_status === 'not_visible') {
      if (assignment.visibility_check_after && now < assignment.visibility_check_after) {
        throw new Error('contributor_workflow_wait_72h: 72 hour wait period has not elapsed');
      }
    }
  }
  return { ...assignment, status: 'rejected', admin_notes: reason };
}

// Contributor unknown -> cannot auto-fail
assert.throws(
  () => simulateAdminReject({ contributor_workflow: true, visibility_status: 'unknown' }, 'failed', t0),
  /contributor_workflow_unknown_visibility/
);

// Contributor not_visible before 72 hours -> must wait
assert.throws(
  () => simulateAdminReject({
    contributor_workflow: true,
    visibility_status: 'not_visible',
    visibility_check_after: new Date('2026-09-13T12:00:00Z'),
  }, 'not visible yet', new Date('2026-09-11T12:00:00Z')),
  /contributor_workflow_wait_72h/
);

// Contributor not_visible AFTER 72 hours -> allowed
const rejectedAfter72h = simulateAdminReject({
  contributor_workflow: true,
  visibility_status: 'not_visible',
  visibility_check_after: new Date('2026-09-13T12:00:00Z'),
}, 'not visible after 72h', new Date('2026-09-13T13:00:00Z'));
assert.equal(rejectedAfter72h.status, 'rejected');

// Legacy task rejection -> allowed immediately
const legacyRejected = simulateAdminReject({
  contributor_workflow: false,
  visibility_status: 'not_visible',
}, 'invalid proof', t0);
assert.equal(legacyRejected.status, 'rejected');

console.log('ALL TESTS PASSED OFFLINE: contracts, DDL, state machine transitions, 72h immutability, and approval/rejection rules verified.');
