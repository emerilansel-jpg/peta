export type TaskEligibilityStatus = 'legacy' | 'pending' | 'approved' | 'revision' | 'rejected';
export type AssignmentVisibilityStatus = 'visible' | 'not_visible' | 'unknown';

export interface TaskAssignment {
  id: string;
  task_id: string;
  user_id: string;
  reddit_account_id?: string | null;
  status: 'in_progress' | 'submitted' | 'approved' | 'rejected';
  draft_comment?: string | null;
  proof_url?: string | null;
  proof_image_url?: string | null;
  submitted_url?: string | null;
  submitted_username?: string | null;
  proof_urls?: string[] | null;
  admin_notes?: string | null;
  can_retry?: boolean;
  contributor_workflow?: boolean;
  first_proof_submitted_at?: string | null;
  visibility_check_after?: string | null;
  visibility_status?: AssignmentVisibilityStatus | null;
  visibility_reason?: string | null;
  balance_credited_at?: string | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: any;
}
