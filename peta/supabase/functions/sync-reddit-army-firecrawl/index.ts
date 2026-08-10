// ============================================================
// PeTa — Sync Reddit Army via Firecrawl (with API Key Rotation)
//
// Scheduled edge function that checks Hero Army challenge tasks
// using Firecrawl API to verify visibility (anti-shadowban).
//
// Features:
//   - Auto-rotates API keys when credits are exhausted (429/402)
//   - Falls back to environment variable if no keys in database
//   - Marks exhausted keys and switches to next available
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
//   - FIRECRAWL_API_KEY (fallback if no keys in database)
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

/**
 * Get the next available Firecrawl API key.
 * First tries database rotation, then falls back to environment variable.
 */
async function getApiKey(supabase: any): Promise<string | null> {
  // Try to get from database rotation
  const { data: dbKey, error: dbError } = await supabase.rpc(
    "get_next_firecrawl_key"
  );

  if (!dbError && dbKey) {
    console.log("Using API key from database rotation");
    return dbKey;
  }

  // Fall back to environment variable
  const envKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (envKey) {
    console.log("Using API key from environment variable");
    return envKey;
  }

  return null;
}

/**
 * Mark an API key as exhausted and get the next available key.
 */
async function rotateApiKey(
  supabase: any,
  exhaustedKey: string,
  errorMessage: string
): Promise<string | null> {
  const { data: nextKey, error } = await supabase.rpc(
    "mark_firecrawl_key_exhausted",
    {
      p_api_key: exhaustedKey,
      p_error_message: errorMessage,
    }
  );

  if (error) {
    console.error("Failed to rotate API key:", error.message);
    return null;
  }

  return nextKey;
}

/**
 * Scrape a URL using Firecrawl API with auto-rotation on failure.
 */
async function scrapeWithRotation(
  supabase: any,
  url: string,
  maxRetries: number = 3
): Promise<{
  success: boolean;
  markdown: string;
  error?: string;
}> {
  let currentKey: string | null = await getApiKey(supabase);

  if (!currentKey) {
    return {
      success: false,
      markdown: "",
      error: "No Firecrawl API keys available",
    };
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const firecrawlResponse = await fetch(
        "https://api.firecrawl.dev/v1/scrape",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${currentKey}`,
          },
          body: JSON.stringify({
            url: url,
            formats: ["markdown"],
            onlyMainContent: true,
            timeout: 30000,
          }),
        }
      );

      // Success case
      if (firecrawlResponse.ok) {
        const firecrawlData = await firecrawlResponse.json();
        const markdown = firecrawlData?.data?.markdown || "";
        return { success: true, markdown };
      }

      // Rate limit or credit exhausted (429 or 402)
      if (firecrawlResponse.status === 429 || firecrawlResponse.status === 402) {
        const errorText = await firecrawlResponse.text();
        console.warn(
          `Firecrawl API key exhausted (attempt ${attempt + 1}): ${firecrawlResponse.status} - ${errorText}`
        );

        // Rotate to next key
        const nextKey = await rotateApiKey(
          supabase,
          currentKey,
          `${firecrawlResponse.status}: ${errorText}`
        );

        if (!nextKey) {
          return {
            success: false,
            markdown: "",
            error: "All Firecrawl API keys exhausted",
          };
        }

        currentKey = nextKey;
        continue; // Retry with new key
      }

      // Other errors (400, 500, etc.) - don't rotate, just fail
      const errorText = await firecrawlResponse.text();
      return {
        success: false,
        markdown: "",
        error: `Firecrawl API error: ${firecrawlResponse.status} - ${errorText}`,
      };
    } catch (scrapeError) {
      return {
        success: false,
        markdown: "",
        error: `Scrape error: ${
          scrapeError instanceof Error ? scrapeError.message : String(scrapeError)
        }`,
      };
    }
  }

  return {
    success: false,
    markdown: "",
    error: "Max retries exceeded",
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

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
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

      // Scrape with auto-rotation
      const scrapeResult = await scrapeWithRotation(supabase, url);

      if (!scrapeResult.success) {
        results.push({
          assignment_id: assignment.id,
          username,
          url,
          status: "error",
          details: scrapeResult.error,
        });
        failed++;
        continue;
      }

      // Step 3: Check if username is visible in the scraped content
      const usernameLower = username.toLowerCase();
      const markdownLower = scrapeResult.markdown.toLowerCase();

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
