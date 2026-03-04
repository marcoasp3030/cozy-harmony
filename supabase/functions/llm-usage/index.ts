import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = claimsData.claims.sub as string;

    // Load user's API keys
    const { data: settings } = await supabase
      .from("settings")
      .select("key, value")
      .eq("user_id", userId)
      .in("key", ["llm_openai", "llm_gemini"]);

    const keys: Record<string, string> = {};
    for (const s of settings || []) {
      const val = s.value as { apiKey?: string };
      if (s.key === "llm_openai" && val?.apiKey) keys.openai = val.apiKey;
      if (s.key === "llm_gemini" && val?.apiKey) keys.gemini = val.apiKey;
    }

    const result: Record<string, any> = {};

    // ── OpenAI: try multiple billing endpoints ──
    if (keys.openai) {
      const openaiResult: any = { configured: true };

      // Try 1: /v1/organization/costs (newer API, requires org permissions)
      try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startDate = startOfMonth.toISOString().split("T")[0];
        const endDate = now.toISOString().split("T")[0];

        const costsResp = await fetch(
          `https://api.openai.com/v1/organization/costs?start_date=${startDate}&end_date=${endDate}&limit=1`,
          {
            headers: { Authorization: `Bearer ${keys.openai}` },
            signal: AbortSignal.timeout(5000),
          }
        );

        if (costsResp.ok) {
          const costsData = await costsResp.json();
          if (costsData?.data?.length) {
            const totalCents = costsData.data.reduce(
              (sum: number, bucket: any) =>
                sum + (bucket.results || []).reduce((s: number, r: any) => s + (r.amount?.value || 0), 0),
              0
            );
            openaiResult.costs = {
              period: `${startDate} → ${endDate}`,
              total_usd: (totalCents / 100).toFixed(4),
              source: "organization/costs",
            };
          }
        }
      } catch {}

      // Try 2: /dashboard/billing/credit_grants (older, works with some keys)
      try {
        const creditsResp = await fetch("https://api.openai.com/dashboard/billing/credit_grants", {
          headers: { Authorization: `Bearer ${keys.openai}` },
          signal: AbortSignal.timeout(5000),
        });
        if (creditsResp.ok) {
          const creditsData = await creditsResp.json();
          if (creditsData?.total_granted !== undefined) {
            openaiResult.credits = {
              total_granted: creditsData.total_granted,
              total_used: creditsData.total_used,
              total_available: creditsData.total_available,
              source: "credit_grants",
            };
          }
        }
      } catch {}

      // Try 3: /v1/organization/billing/subscription
      try {
        const subResp = await fetch("https://api.openai.com/v1/organization/billing/subscription", {
          headers: { Authorization: `Bearer ${keys.openai}` },
          signal: AbortSignal.timeout(5000),
        });
        if (subResp.ok) {
          const subData = await subResp.json();
          openaiResult.subscription = {
            plan: subData.plan?.title || subData.plan?.id || "unknown",
            hard_limit_usd: subData.hard_limit_usd,
            soft_limit_usd: subData.soft_limit_usd,
            source: "billing/subscription",
          };
        }
      } catch {}

      // Try 4: /v1/organization/usage (completions usage for current month)
      try {
        const now = new Date();
        const startOfMonth = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
        const usageResp = await fetch(
          `https://api.openai.com/v1/organization/usage/completions?start_time=${startOfMonth}&limit=1&group_by=model`,
          {
            headers: { Authorization: `Bearer ${keys.openai}`, "Content-Type": "application/json" },
            signal: AbortSignal.timeout(5000),
          }
        );
        if (usageResp.ok) {
          const usageData = await usageResp.json();
          if (usageData?.data?.length) {
            const totals = usageData.data.reduce(
              (acc: any, bucket: any) => {
                for (const r of bucket.results || []) {
                  acc.input_tokens += r.input_tokens || 0;
                  acc.output_tokens += r.output_tokens || 0;
                  acc.num_requests += r.num_model_requests || 0;
                }
                return acc;
              },
              { input_tokens: 0, output_tokens: 0, num_requests: 0 }
            );
            openaiResult.usage = { ...totals, source: "organization/usage" };
          }
        }
      } catch {}

      // Check if we got any data at all
      if (!openaiResult.costs && !openaiResult.credits && !openaiResult.subscription && !openaiResult.usage) {
        openaiResult.note = "Não foi possível acessar dados de billing. Sua API Key pode não ter permissões de organização. Verifique em platform.openai.com/settings/organization/billing";
      }

      result.openai = openaiResult;
    } else {
      result.openai = { configured: false };
    }

    // ── Gemini: no billing API for consumer keys ──
    if (keys.gemini) {
      const geminiResult: any = { configured: true };

      // Try to get project billing info (only works for Cloud projects)
      // For AI Studio keys, there's no billing API — just note the free tier info
      geminiResult.note = "O Google AI Studio oferece uso gratuito com limites de RPM/RPD. Para uso pago, verifique seu billing no Google Cloud Console.";

      // We can at least verify the key is valid and check rate limits via a simple models call
      try {
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${keys.gemini}`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (resp.ok) {
          const data = await resp.json();
          geminiResult.available_models = (data.models || [])
            .filter((m: any) => m.name?.includes("gemini"))
            .length;
          geminiResult.status = "active";
        } else if (resp.status === 429) {
          geminiResult.status = "rate_limited";
          geminiResult.note = "⚠️ Cota esgotada! Aguarde ou faça upgrade no Google AI Studio.";
        } else {
          geminiResult.status = "error";
        }
      } catch {}

      result.gemini = geminiResult;
    } else {
      result.gemini = { configured: false };
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("llm-usage error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
