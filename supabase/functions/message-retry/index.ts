import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Exponential backoff: attempt 1 = 30s, 2 = 2min, 3 = 8min, 4 = 32min, 5 = 2h
function getBackoffMs(attempt: number): number {
  const baseMs = 30_000; // 30 seconds
  return baseMs * Math.pow(4, attempt - 1);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const now = new Date().toISOString();

    // Fetch up to 50 items ready for retry
    const { data: items, error: fetchErr } = await supabase
      .from("message_retry_queue")
      .select("*, whatsapp_instances(base_url, instance_token)")
      .in("status", ["pending", "retrying"])
      .lte("next_retry_at", now)
      .order("next_retry_at", { ascending: true })
      .limit(50);

    if (fetchErr) {
      console.error("[RETRY] Error fetching queue:", fetchErr);
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ processed: 0, message: "Queue empty" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[RETRY] Processing ${items.length} items`);

    let delivered = 0;
    let failed = 0;
    let requeued = 0;

    for (const item of items) {
      const instance = item.whatsapp_instances as any;
      if (!instance?.base_url || !instance?.instance_token) {
        // Instance deleted — mark as permanently failed
        await supabase
          .from("message_retry_queue")
          .update({
            status: "failed",
            last_error: "Instância WhatsApp não encontrada ou excluída",
            resolved_at: now,
          })
          .eq("id", item.id);
        failed++;
        continue;
      }

      const payload = item.payload as Record<string, any>;
      const baseUrl = instance.base_url.replace(/\/+$/, "");
      const endpoint = payload._endpoint || "/send/text";
      const sendBody = { ...payload };
      delete sendBody._endpoint;

      try {
        const res = await fetch(`${baseUrl}${endpoint}`, {
          method: "POST",
          headers: {
            token: instance.instance_token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(sendBody),
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok) {
          // Success! Mark as delivered
          await supabase
            .from("message_retry_queue")
            .update({
              status: "delivered",
              resolved_at: new Date().toISOString(),
              last_attempted_at: new Date().toISOString(),
              attempts: item.attempts + 1,
            })
            .eq("id", item.id);

          // Update original message status if linked
          if (item.message_id) {
            await supabase
              .from("messages")
              .update({ status: "sent" })
              .eq("id", item.message_id);
          }

          delivered++;
          console.log(`[RETRY] ✅ Delivered: ${item.phone} (attempt ${item.attempts + 1})`);
        } else {
          // Failed again
          const newAttempts = item.attempts + 1;
          const errorMsg = data?.message || data?.error || `HTTP ${res.status}`;

          if (newAttempts >= item.max_attempts) {
            // Max attempts reached — permanently failed
            await supabase
              .from("message_retry_queue")
              .update({
                status: "failed",
                last_error: errorMsg,
                last_attempted_at: new Date().toISOString(),
                attempts: newAttempts,
                resolved_at: new Date().toISOString(),
              })
              .eq("id", item.id);
            failed++;
            console.log(`[RETRY] ❌ Permanently failed: ${item.phone} after ${newAttempts} attempts — ${errorMsg}`);
          } else {
            // Schedule next retry with exponential backoff
            const backoffMs = getBackoffMs(newAttempts);
            const nextRetry = new Date(Date.now() + backoffMs).toISOString();

            await supabase
              .from("message_retry_queue")
              .update({
                status: "retrying",
                last_error: errorMsg,
                last_attempted_at: new Date().toISOString(),
                attempts: newAttempts,
                next_retry_at: nextRetry,
              })
              .eq("id", item.id);
            requeued++;
            console.log(`[RETRY] 🔄 Requeued: ${item.phone} (attempt ${newAttempts}, next in ${Math.round(backoffMs / 1000)}s)`);
          }
        }
      } catch (e) {
        // Network error — requeue
        const newAttempts = item.attempts + 1;
        const errorMsg = e instanceof Error ? e.message : "Network error";

        if (newAttempts >= item.max_attempts) {
          await supabase
            .from("message_retry_queue")
            .update({
              status: "failed",
              last_error: errorMsg,
              last_attempted_at: new Date().toISOString(),
              attempts: newAttempts,
              resolved_at: new Date().toISOString(),
            })
            .eq("id", item.id);
          failed++;
        } else {
          const backoffMs = getBackoffMs(newAttempts);
          await supabase
            .from("message_retry_queue")
            .update({
              status: "retrying",
              last_error: errorMsg,
              last_attempted_at: new Date().toISOString(),
              attempts: newAttempts,
              next_retry_at: new Date(Date.now() + backoffMs).toISOString(),
            })
            .eq("id", item.id);
          requeued++;
        }
      }

      // Small delay between retries to avoid flooding
      await new Promise((r) => setTimeout(r, 1000));
    }

    console.log(`[RETRY] Done: ${delivered} delivered, ${requeued} requeued, ${failed} failed`);

    return new Response(
      JSON.stringify({ processed: items.length, delivered, requeued, failed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[RETRY] Fatal error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
