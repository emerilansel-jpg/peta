// ============================================================
// PeTa — Sync Reddit Army via Firecrawl
//
// Scheduled edge function that checks Hero Army challenge tasks
// using Firecrawl API to verify visibility (anti-shadowban).
//
// Flow:
//   1. Fetch all 'in_progress' task_assignments for reddit_challenge tasks
//   2. For each assignment with a submitted_url, scrape via Firecrawl
//   3. If content contains username → auto-approve (is_verified_firecrawl = true)
//   4. If not found → mark for admin manual review
//
// Environment variables required:
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//   - FIRECRAWL_API_KEY
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface TaskAssignment {
  id: string;
  task_id: string;
  reddit_account_id: string;
  user_id: string;
  submitted_url: string | null;
  proof_url: string | null;
  status: string;
  tasks: {
    title: string;
    task_category: string;
    target_url: string;
  };
  reddit_accounts: {
    username: string;
  };
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client with service role key
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY") ?? "";

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }

    if (!firecrawlKey) {
      throw new Error("Missing FIRECRAWL_API_KEY");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Step 1: Fetch all in_progress reddit_challenge assignments with submitted_url
    const { data: assignments, error: fetchError } = await supabase
      .from("task_assignments")
      .select(`
        id,
        task_id,
        reddit_account_id,
        user_id,
        submitted_url,
        proof_url,
        status,
        tasks!inner (
          title,
          task_category,
          target_url
        ),
        reddit_accounts!inner (
          username
        )
      `)
      .eq("status", "in_progress")
      .eq("tasks.task_category", "reddit_challenge")
      .not("submitted_url", "is", null)
      .limit(50);  // Process max 50 per run to avoid timeout

    if (fetchError) {
      throw new Error(`Failed to fetch assignments: ${fetchError.message}`);
    }

    if (!assignments || assignments.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No pending assignments to check",
          checked: 0,
          verified: 0,
          failed: 0,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    let verified = 0;
    let failed = 0;
    const results: Array<{
      assignment_id: string;
      username: string;
      url: string;
      status: "verified" | "not_found" | "error";
      details?: string;
    }> = [];

    // Step 2: Check each assignment via Firecrawl
    for (const assignment of assignments as TaskAssignment[]) {
      const username = assignment.reddit_accounts.username;
      const url = assignment.submitted_url;

      if (!url) {
        results.push({
          assignment_id: assignment.id,
          username,
          url: "null",
          status: "error",
          details: "No submitted_url",
        });
        failed++;
        continue;
      }

      try {
        // Call Firecrawl API to scrape the URL
        const firecrawlResponse = await fetch(
          "https://api.firecrawl.dev/v1/scrape",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${firecrawlKey}`,
            },
            body: JSON.stringify({
              url: url,
              formats: ["markdown"],
              onlyMainContent: true,
              timeout: 30000,
            }),
          }
        );

        if (!firecrawlResponse.ok) {
          const errorText = await firecrawlResponse.text();
          results.push({
            assignment_id: assignment.id,
            username,
            url,
            status: "error",
            details: `Firecrawl API error: ${firecrawlResponse.status} - ${errorText}`,
          });
          failed++;
          continue;
        }

        const firecrawlData = await firecrawlResponse.json();
        const markdown = firecrawlData?.data?.markdown || "";

        // Step 3: Check if username is visible in the scraped content
        // Look for username in various formats:
        //   - u/username
        //   - /user/username
        //   - username (exact match, case-insensitive)
        const usernameLower = username.toLowerCase();
        const markdownLower = markdown.toLowerCase();

        const isVisible =
          markdownLower.includes(`u/${usernameLower}`) ||
          markdownLower.includes(`/user/${usernameLower}`) ||
          markdownLower.includes(usernameLower);

        if (isVisible) {
          // Step 4a: Auto-verify — username found in content
          const { error: updateError } = await supabase
            .from("task_assignments")
            .update({
              is_verified_firecrawl: true,
              firecrawl_verified_at: new Date().toISOString(),
            })
            .eq("id", assignment.id);

          if (updateError) {
            results.push({
              assignment_id: assignment.id,
              username,
              url,
              status: "error",
              details: `DB update failed: ${updateError.message}`,
            });
            failed++;
          } else {
            results.push({
              assignment_id: assignment.id,
              username,
              url,
              status: "verified",
            });
            verified++;
          }
        } else {
          // Step 4b: Username not found — possible shadowban
          // Leave is_verified_firecrawl = false for admin manual review
          results.push({
            assignment_id: assignment.id,
            username,
            url,
            status: "not_found",
            details:
              "Username not found in scraped content. Possible shadowban or deleted comment.",
          });
          failed++;
        }
      } catch (scrapeError) {
        results.push({
          assignment_id: assignment.id,
          username,
          url,
          status: "error",
          details: `Scrape error: ${
            scrapeError instanceof Error
              ? scrapeError.message
              : String(scrapeError)
          }`,
        });
        failed++;
      }

      // Rate limiting: wait 500ms between Firecrawl calls
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Step 5: Log results to activity_logs for admin monitoring
    await supabase.from("activity_logs").insert({
      user_id: null,  // System-level log
      action: "firecrawl_sync_completed",
      details: {
        total_checked: assignments.length,
        verified,
        failed,
        results: results.slice(0, 20),  // Keep first 20 for brevity
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: `Checked ${assignments.length} assignments`,
        checked: assignments.length,
        verified,
        failed,
        results,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Firecrawl sync error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
