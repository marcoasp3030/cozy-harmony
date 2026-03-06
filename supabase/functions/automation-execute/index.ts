import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface FlowNode {
  id: string;
  type: string;
  data: Record<string, any>;
  position: { x: number; y: number };
}

interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
}

interface FlowData {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

interface ExecutionContext {
  contactId: string;
  contactPhone: string;
  contactName: string;
  messageContent: string;
  messageType: string;
  conversationId: string;
  userId: string | null;
  instanceId: string | null;
  variables: Record<string, string>;
  isFirstContact: boolean;
  nodeLog: NodeLogEntry[];
  sessionStartedAt: string | null; // ISO timestamp — only messages AFTER this are included in AI context
}

interface NodeLogEntry {
  nodeId: string;
  nodeType: string;
  nodeLabel: string;
  status: "success" | "error" | "skipped";
  result?: any;
  error?: string;
  startedAt: string;
  durationMs: number;
}

// ── Cached WhatsApp instance lookup (avoids 5+ DB queries per execution) ──
const instanceCache = new Map<string, { base_url: string; instance_token: string } | null>();

async function getCachedInstance(supabase: any, userId: string | null, instanceId?: string | null): Promise<{ base_url: string; instance_token: string } | null> {
  const cacheKey = instanceId || userId || "__default__";
  if (instanceCache.has(cacheKey)) return instanceCache.get(cacheKey)!;

  // If automation is linked to a specific instance, use that one
  if (instanceId) {
    const { data: instance } = await supabase
      .from("whatsapp_instances")
      .select("id, base_url, instance_token")
      .eq("id", instanceId)
      .maybeSingle();
    const result = instance?.base_url && instance?.instance_token ? instance : null;
    if (result) {
      instanceCache.set(cacheKey, result);
      return result;
    }
    // Fall through to default lookup if instance_id not found
  }

  let query = supabase
    .from("whatsapp_instances")
    .select("id, base_url, instance_token")
    .order("is_default", { ascending: false })
    .limit(1);
  if (userId) query = query.eq("user_id", userId);
  const { data: instance } = await query.maybeSingle();

  const result = instance?.base_url && instance?.instance_token ? instance : null;
  instanceCache.set(cacheKey, result);
  return result;
}

// Track providers that failed with quota/auth errors within this request to skip retries
const disabledProviders = new Set<string>();

// ── Model name mapping: translate OpenAI model names to Gemini equivalents ──
function mapModelForProvider(model: string, targetProvider: "openai" | "gemini"): string {
  if (targetProvider === "gemini") {
    const geminiMap: Record<string, string> = {
      "gpt-4o": "gemini-2.5-flash",
      "gpt-4o-2024-11-20": "gemini-2.5-flash",
      "gpt-4o-mini": "gemini-2.5-flash",
      "gpt-4-turbo": "gemini-2.5-flash",
      "gpt-4": "gemini-2.5-flash",
      "gpt-3.5-turbo": "gemini-2.5-flash-lite",
      "o1": "gemini-2.5-pro",
      "o3-mini": "gemini-2.5-flash",
    };
    return geminiMap[model] || (model.startsWith("gpt") || model.startsWith("o") ? "gemini-2.5-flash" : model);
  }
  if (targetProvider === "openai") {
    const openaiMap: Record<string, string> = {
      "gemini-2.5-flash": "gpt-4o-2024-11-20",
      "gemini-2.5-flash-lite": "gpt-4o-2024-11-20",
      "gemini-2.5-pro": "gpt-4o-2024-11-20",
    };
    return openaiMap[model] || (model.startsWith("gemini") ? "gpt-4o-2024-11-20" : model);
  }
  return model;
}

// Check if a model is an OpenAI reasoning model (o1, o3, etc.) that uses different API params
function isReasoningModel(model: string): boolean {
  return /^o[0-9]/.test(model);
}

// ── Reply style guard: enforce natural WhatsApp responses (supports multi-message) ──
function enforceConciseNaturalReply(text: string): string {
  if (!text) return text;

  let cleaned = text
    .replace(/\r/g, "")
    .trim();

  const bannedPatterns = [
    /obrigad[oa]\s+por\s+nos?\s+avisar[^.!?\n]*[.!?]?/gi,
    /a\s+sua\s+colaboraç[aã]o[^.!?\n]*[.!?]?/gi,
    /se\s+precisar\s+de\s+mais\s+alguma\s+coisa[^.!?\n]*[.!?]?/gi,
    /qualquer\s+coisa[^.!?\n]*[.!?]?/gi,
    /fico\s+[àa]\s+disposiç[aã]o[^.!?\n]*[.!?]?/gi,
    /estou\s+aqui(?:\s+para\s+ajudar)?[^.!?\n]*[.!?]?/gi,
  ];

  for (const pattern of bannedPatterns) {
    cleaned = cleaned.replace(pattern, " ");
  }

  cleaned = cleaned
    .replace(/\bencaminhar\s+essa\s+informaç[aã]o\b/gi, "passar isso")
    .replace(/\bencaminhar\b/gi, "passar")
    .replace(/\bo\s+mais\s+r[aá]pido\s+poss[ií]vel\b/gi, "o quanto antes")
    .replace(/\s{2,}/g, " ")
    .trim();

  // If the AI used --- separators, clean each segment individually
  if (cleaned.includes("---")) {
    const segments = cleaned.split(/\n*---\n*/).map(s => s.trim()).filter(Boolean);
    return segments.slice(0, 3).join("\n---\n");
  }

  // For single-block replies, limit to 3 sentences max
  const sentences = (cleaned.match(/[^.!?]+[.!?]?/g) || [])
    .map((s) => s.trim())
    .filter(Boolean);

  let concise = sentences.slice(0, 3).join(" ").trim();

  if (!concise) {
    concise = "Entendi! Me envia uma 📸 foto do código de barras do produto para eu consultar o valor 😊";
  }

  if (concise.length > 300) {
    concise = concise.slice(0, 300).replace(/\s+\S*$/, "").trim();
    if (!/[.!?]$/.test(concise)) concise += ".";
  }

  return concise;
}

// ── Cached user AI keys lookup ──
const userKeysCache = new Map<string, { keys: Record<string, string>; timeout: number }>();

async function getUserAIKeys(supabase: any, userId: string | null): Promise<{ keys: Record<string, string>; aiTimeout: number }> {
  if (!userId) return { keys: {}, aiTimeout: 15 };
  
  if (userKeysCache.has(userId)) {
    const cached = userKeysCache.get(userId)!;
    return { keys: cached.keys, aiTimeout: cached.timeout };
  }

  const { data: settings } = await supabase
    .from("settings")
    .select("key, value")
    .eq("user_id", userId)
    .in("key", ["llm_openai", "llm_gemini", "ai_timeout"]);

  const keys: Record<string, string> = {};
  let aiTimeout = 15;
  for (const s of settings || []) {
    const val = s.value as any;
    if (s.key === "llm_openai" && val?.apiKey) keys.openai = val.apiKey;
    if (s.key === "llm_gemini" && val?.apiKey) keys.gemini = val.apiKey;
    if (s.key === "ai_timeout" && val?.seconds) aiTimeout = val.seconds;
  }

  userKeysCache.set(userId, { keys, timeout: aiTimeout });
  return { keys, aiTimeout };
}

// ── Helper: call AI with user's OpenAI/Gemini keys ──
async function callAIWithUserKeys(
  keys: Record<string, string>,
  prompt: string,
  options: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {}
): Promise<string> {
  const { maxTokens = 300, temperature = 0.2, timeoutMs = 15000 } = options;

  // Determine provider order: prefer Gemini if OpenAI is disabled or unavailable
  const providers: Array<"openai" | "gemini"> = [];
  if (keys.openai && !disabledProviders.has("openai")) providers.push("openai");
  if (keys.gemini && !disabledProviders.has("gemini")) providers.push("gemini");
  // If OpenAI was disabled but Gemini wasn't added yet, add it
  if (providers.length === 0 && keys.gemini) providers.push("gemini");
  if (providers.length === 0 && keys.openai) providers.push("openai");

  for (const provider of providers) {
    if (provider === "openai") {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${keys.openai}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4o-2024-11-20",
            messages: [{ role: "system", content: prompt }],
            max_tokens: maxTokens,
            temperature: 0.7,
          }),
          signal: controller.signal,
        });
        clearTimeout(tid);
        if (resp.ok) {
          const data = await resp.json();
          return data.choices?.[0]?.message?.content?.trim() || "";
        }
        const errText = await resp.text();
        console.error(`[AI] OpenAI error (${resp.status}):`, errText.slice(0, 100));
        // Disable OpenAI for remaining calls in this request if quota/auth error
        if (resp.status === 429 || resp.status === 401 || resp.status === 403) {
          disabledProviders.add("openai");
          console.log(`[AI] OpenAI disabled for remaining calls (${resp.status})`);
        }
      } catch (e) {
        clearTimeout(tid);
        console.error("[AI] OpenAI call failed:", e);
      }
    }

    if (provider === "gemini") {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keys.gemini}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: maxTokens, temperature },
            }),
            signal: controller.signal,
          }
        );
        clearTimeout(tid);
        if (resp.ok) {
          const data = await resp.json();
          return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
        }
        const errText = await resp.text();
        console.error(`[AI] Gemini error (${resp.status}):`, errText.slice(0, 100));
        if (resp.status === 429 || resp.status === 401 || resp.status === 403) {
          disabledProviders.add("gemini");
          console.log(`[AI] Gemini disabled for remaining calls (${resp.status})`);
        }
      } catch (e) {
        clearTimeout(tid);
        console.error("[AI] Gemini call failed:", e);
      }
    }
  }

  return "";
}

// ── Helper: call AI with vision (image analysis) using user keys ──
async function callAIVisionWithUserKeys(
  keys: Record<string, string>,
  prompt: string,
  imageBase64: string,
  options: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {}
): Promise<string> {
  const { maxTokens = 600, temperature = 0.2, timeoutMs = 30000 } = options;

  // Prefer Gemini for vision (native support, better for images)
  if (keys.gemini) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keys.gemini}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              role: "user",
              parts: [
                { text: prompt },
                { inline_data: { mime_type: "image/jpeg", data: imageBase64 } },
              ],
            }],
            generationConfig: { maxOutputTokens: maxTokens, temperature },
          }),
          signal: controller.signal,
        }
      );
      clearTimeout(tid);
      if (resp.ok) {
        const data = await resp.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
      }
      const errText = await resp.text();
      console.error(`[AI-VISION] Gemini error (${resp.status}):`, errText.slice(0, 100));
    } catch (e) {
      clearTimeout(tid);
      console.error("[AI-VISION] Gemini call failed:", e);
    }
  }

  // Fallback to OpenAI vision
  if (keys.openai) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${keys.openai}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-2024-11-20",
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
            ],
          }],
          max_tokens: maxTokens,
          temperature,
        }),
        signal: controller.signal,
      });
      clearTimeout(tid);
      if (resp.ok) {
        const data = await resp.json();
        return data.choices?.[0]?.message?.content?.trim() || "";
      }
      const errText = await resp.text();
      console.error(`[AI-VISION] OpenAI error (${resp.status}):`, errText.slice(0, 100));
    } catch (e) {
      clearTimeout(tid);
      console.error("[AI-VISION] OpenAI call failed:", e);
    }
  }

  return "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Clear caches per request
  instanceCache.clear();
  disabledProviders.clear();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const {
      contactId,
      contactPhone,
      contactName,
      messageContent,
      messageType,
      conversationId: rawConversationId,
      isFirstContact,
    } = await req.json();

    // Guard against "undefined" string being passed as conversationId
    const conversationId = rawConversationId && rawConversationId !== "undefined" ? rawConversationId : null;

    console.log(`Automation trigger: phone=${contactPhone}, type=${messageType}, msg="${(messageContent || "").slice(0, 50)}", convId=${conversationId || "NONE"}`);
    // Load all active automations
    const { data: automations, error: autoErr } = await supabase
      .from("automations")
      .select("*")
      .eq("is_active", true);

    if (autoErr || !automations || automations.length === 0) {
      console.log("No active automations found");
      return json({ success: true, executed: 0 });
    }

    let totalExecuted = 0;

    for (const automation of automations) {
      const flow = automation.flow as FlowData;
      if (!flow?.nodes?.length || !flow?.edges?.length) continue;

      // Find trigger nodes
      const triggerNodes = flow.nodes.filter((n) => n.data?.nodeType?.startsWith("trigger_"));
      if (triggerNodes.length === 0) continue;

      // Check if any trigger matches
      let triggered = false;
      for (const trigger of triggerNodes) {
        const nodeType = trigger.data.nodeType as string;

        if (nodeType === "trigger_message") {
          triggered = true;
          break;
        }

        if (nodeType === "trigger_first_contact" && isFirstContact) {
          triggered = true;
          break;
        }

        if (nodeType === "trigger_keyword") {
          const keywords = String(trigger.data.keywords || "")
            .split(",")
            .map((k: string) => k.trim().toLowerCase())
            .filter(Boolean);
          const matchType = trigger.data.match_type || "contains";
          const content = (messageContent || "").toLowerCase();

          if (keywords.length > 0) {
            const match = keywords.some((kw: string) => {
              if (matchType === "exact") return content === kw;
              if (matchType === "starts_with") return content.startsWith(kw);
              return content.includes(kw);
            });
            if (match) {
              triggered = true;
              break;
            }
          }
        }

        // trigger_schedule is handled by cron, not by message events
      }

      if (!triggered) continue;

      // ── Skip if a HUMAN agent is actively handling this conversation ──
      if (conversationId && contactId) {
        // Check 1: Conversation was formally escalated (assigned + waiting/in_progress)
        const { data: convCheck } = await supabase
          .from("conversations")
          .select("assigned_to, status")
          .eq("id", conversationId)
          .maybeSingle();

        if (convCheck?.assigned_to && ["waiting", "in_progress"].includes(convCheck.status)) {
          console.log(`[HUMAN-ACTIVE] Skipping automation "${automation.name}" — conversation assigned to human (status=${convCheck.status})`);
          continue;
        }

        // Check 2: A human sent a manual message recently (not from automation)
        // Automation messages have user_id = automation owner but metadata is null or has no "manual" flag
        // Manual messages from the inbox have the agent's user_id and are sent through the panel
        // We detect this by finding recent outbound messages NOT created by the automation system
        const humanWindowMinutes = 30; // If a human replied in last 30min, pause IA
        const humanCutoff = new Date(Date.now() - humanWindowMinutes * 60 * 1000).toISOString();

        const { data: recentOutbound } = await supabase
          .from("messages")
          .select("id, user_id, content, metadata, created_at")
          .eq("contact_id", contactId)
          .eq("direction", "outbound")
          .gte("created_at", humanCutoff)
          .order("created_at", { ascending: false })
          .limit(10);

        if (recentOutbound && recentOutbound.length > 0) {
          // Filter: messages sent by a human agent (not by automation)
          // Automation-sent messages typically have metadata.source = "automation" or are sent by the automation owner
          // Manual messages from inbox don't have this marker
          const automationOwnerId = automation.created_by;
          const humanMessages = recentOutbound.filter((msg: any) => {
            const meta = msg.metadata as any;
            // If metadata explicitly says "automation", it's not human
            if (meta?.source === "automation") return false;
            // If the message was sent by someone OTHER than the automation owner, it's definitely human
            if (msg.user_id && msg.user_id !== automationOwnerId) return true;
            // If sent by automation owner but has manual flag, it's human
            if (meta?.source === "manual" || meta?.source === "inbox") return true;
            // Check if the content matches known automation patterns (skip those)
            const content = (msg.content || "").toLowerCase();
            const isAutomationPattern = /nutricar brasil.*mini mercado|_nutricar brasil_|estou transferindo você/i.test(content);
            if (isAutomationPattern) return false;
            // If sent by same user as automation owner and no clear signal, check if it could be manual
            // Conservative: if the automation owner sends from inbox, we want to detect it
            // We'll mark it as human if there's no automation marker at all
            if (msg.user_id === automationOwnerId && !meta?.source) {
              // Ambiguous — could be either. Use a heuristic:
              // Automation messages are usually sent within seconds of each other in bursts
              // Manual messages are standalone. Check if this message has NO automation log near its timestamp.
              return false; // Conservative: don't block unless clearly manual
            }
            return false;
          });

          if (humanMessages.length > 0) {
            const lastHumanMsg = humanMessages[0];
            const minutesAgo = Math.round((Date.now() - new Date(lastHumanMsg.created_at).getTime()) / 60000);
            console.log(`[HUMAN-ACTIVE] Skipping automation "${automation.name}" — human agent sent message ${minutesAgo}min ago (msg_id=${lastHumanMsg.id}, user=${lastHumanMsg.user_id})`);
            continue;
          }
        }
      }

      // ── Debounce: use insert-first pattern to prevent race conditions ──
      const collectNode = flow.nodes.find((n: FlowNode) => n.data?.nodeType === "action_collect_messages");
      const debounceSeconds = collectNode ? (parseInt(collectNode.data.wait_seconds) || 15) + 3 : 12;

      // Create log entry FIRST to claim the slot (atomic insert)
      const { data: logEntry, error: logInsertErr } = await supabase
        .from("automation_logs")
        .insert({
          automation_id: automation.id,
          contact_id: contactId || null,
          contact_phone: contactPhone,
          trigger_type: automation.trigger_type,
          status: "running",
        })
        .select("id, started_at")
        .single();

      if (logInsertErr) {
        console.error(`Failed to create log entry: ${logInsertErr.message}`, logInsertErr);
        continue;
      }

      // Now check if there's an OLDER run within the debounce window (not our own)
      const debounceCutoff = new Date(Date.now() - debounceSeconds * 1000).toISOString();
      const { data: recentRuns } = await supabase
        .from("automation_logs")
        .select("id, status, started_at")
        .eq("automation_id", automation.id)
        .eq("contact_phone", contactPhone)
        .gte("started_at", debounceCutoff)
        .neq("id", logEntry.id)
        .in("status", ["running", "completed"])
        .order("started_at", { ascending: true })
        .limit(1);

      if (recentRuns && recentRuns.length > 0) {
        // Don't block if the "running" entry is stale (>5 min old — likely a crashed execution)
        const isStaleRunning = recentRuns[0].status === "running" &&
          (Date.now() - new Date(recentRuns[0].started_at).getTime()) > 5 * 60 * 1000;

        if (isStaleRunning) {
          // Auto-fix: mark stale entry as completed with error
          await supabase.from("automation_logs").update({
            status: "completed",
            completed_at: new Date().toISOString(),
            error: "Auto-finalizado: execução travada detectada",
          }).eq("id", recentRuns[0].id);
          console.log(`Auto-fixed stale running log ${recentRuns[0].id}, proceeding with new execution`);
        } else {
          // ── BATCH CART BYPASS: allow new images through when cart is active ──
          const isImageMessage = messageType === "image";
          const previousRunCompleted = recentRuns[0].status === "completed";
          const previousRunRunning = recentRuns[0].status === "running";

          let allowBatchBypass = false;

          if (isImageMessage) {
            // Check if there's an active cart session by looking for recent "✅ Adicionado!" markers
            if (contactId) {
              const { data: cartMarkers } = await supabase
                .from("messages")
                .select("id")
                .eq("contact_id", contactId)
                .eq("direction", "outbound")
                .ilike("content", "%✅ Adicionado!%")
                .gte("created_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
                .limit(1);

              if (cartMarkers && cartMarkers.length > 0) {
                allowBatchBypass = true;
                console.log(`[BATCH] Cart session active for ${contactPhone}, allowing image through debounce`);
              }
            }

            // Even without cart markers, if previous run completed, allow new images
            // (first image completed → second image should go through to auto-add)
            if (previousRunCompleted) {
              allowBatchBypass = true;
              console.log(`[BATCH] Previous run completed, allowing new image for ${contactPhone}`);
            }

            // If previous run is still running, wait briefly for it to finish
            if (previousRunRunning && !allowBatchBypass) {
              console.log(`[BATCH] Previous run still running for ${contactPhone}, waiting...`);
              let waited = 0;
              const maxWaitMs = 20000; // wait up to 20s
              const pollMs = 2000;
              while (waited < maxWaitMs) {
                await new Promise(r => setTimeout(r, pollMs));
                waited += pollMs;
                const { data: checkRun } = await supabase
                  .from("automation_logs")
                  .select("status")
                  .eq("id", recentRuns[0].id)
                  .maybeSingle();
                if (!checkRun || checkRun.status !== "running") {
                  allowBatchBypass = true;
                  console.log(`[BATCH] Previous run finished after ${waited}ms, proceeding`);
                  break;
                }
              }
              if (!allowBatchBypass) {
                console.log(`[BATCH] Timeout waiting for previous run, proceeding anyway`);
                allowBatchBypass = true;
              }
            }
          }

          if (!allowBatchBypass) {
            // Delete our duplicate log entry
            await supabase.from("automation_logs").delete().eq("id", logEntry.id);
            console.log(`Debounce: skipping automation "${automation.name}" for ${contactPhone} (older run ${recentRuns[0].id})`);
            continue;
          }
        }
      }

      console.log(`Automation "${automation.name}" (${automation.id}) triggered, log=${logEntry.id}`);

      const startTime = Date.now();
      // Fetch conversation/session boundary to avoid leaking context from resolved issues
      let sessionStartedAt: string | null = null;
      let sessionBoundaryTs = 0;

      if (conversationId) {
        const { data: convData } = await supabase
          .from("conversations")
          .select("created_at")
          .eq("id", conversationId)
          .maybeSingle();
        if (convData?.created_at) {
          sessionBoundaryTs = new Date(convData.created_at).getTime();
        }
      }

      // If there is a RESOLVED occurrence for this contact, start a fresh session from that timestamp
      // (prevents old solved problems from contaminating the new atendimento)
      try {
        let resolvedOccQuery = supabase
          .from("occurrences")
          .select("resolved_at, updated_at, created_at")
          .eq("contact_phone", contactPhone)
          .eq("status", "resolvido")
          .order("resolved_at", { ascending: false, nullsFirst: false })
          .order("updated_at", { ascending: false })
          .limit(1);

        if (automation.created_by) {
          resolvedOccQuery = resolvedOccQuery.eq("created_by", automation.created_by);
        }

        const { data: resolvedOcc } = await resolvedOccQuery;
        if (resolvedOcc && resolvedOcc.length > 0) {
          const occ = resolvedOcc[0] as any;
          const resolvedTs = new Date(occ.resolved_at || occ.updated_at || occ.created_at).getTime();
          if (Number.isFinite(resolvedTs) && resolvedTs > sessionBoundaryTs) {
            sessionBoundaryTs = resolvedTs;
          }
        }
      } catch (boundaryErr) {
        console.error("[SESSION] Failed to load resolved occurrence boundary:", boundaryErr);
      }

      if (sessionBoundaryTs > 0) {
        sessionStartedAt = new Date(sessionBoundaryTs).toISOString();
      }

      console.log(`[SESSION] Using session boundary for ${contactPhone}: ${sessionStartedAt || "none"}`);

      const ctx: ExecutionContext = {
        contactId,
        contactPhone,
        contactName: contactName || "",
        messageContent: messageContent || "",
        messageType: messageType || "text",
        conversationId,
        userId: automation.created_by || null,
        instanceId: automation.instance_id || null,
        variables: {
          _audit_session_boundary: sessionStartedAt
            ? `${sessionStartedAt} (${new Date(sessionStartedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })})`
            : "Sem fronteira — contexto completo",
        },
        isFirstContact: !!isFirstContact,
        nodeLog: [],
        sessionStartedAt,
      };

      let execError: string | null = null;

      try {
        // Execute flow starting from trigger nodes
        const visited = new Set<string>();
        for (const trigger of triggerNodes) {
          await executeFromNode(supabase, flow, trigger.id, ctx, visited);
        }
      } catch (flowErr) {
        execError = flowErr instanceof Error ? flowErr.message : "Unknown flow error";
        console.error(`Flow execution error: ${execError}`);
      }

      const durationMs = Date.now() - startTime;

      // Collect audit variables for the log entry
      const auditTrail: Record<string, string> = {};
      for (const [key, value] of Object.entries(ctx.variables)) {
        if (key.startsWith("_audit_") || key === "_pix_key_sent") {
          auditTrail[key] = value;
        }
      }

      // Update log entry with results
      if (logEntry) {
        await supabase
          .from("automation_logs")
          .update({
            status: execError ? "error" : "completed",
            completed_at: new Date().toISOString(),
            duration_ms: durationMs,
            nodes_executed: [...ctx.nodeLog, ...(Object.keys(auditTrail).length > 0 ? [{
              nodeId: "_audit",
              nodeType: "audit_trail",
              nodeLabel: "Auditoria PIX & Segurança",
              status: "success",
              result: auditTrail,
              startedAt: new Date().toISOString(),
              durationMs: 0,
            }] : [])],
            error: execError,
          })
          .eq("id", logEntry.id);
      }

      // Update stats
      const stats = (automation.stats as any) || { executions: 0, success: 0, failed: 0 };
      stats.executions = (stats.executions || 0) + 1;
      if (execError) {
        stats.failed = (stats.failed || 0) + 1;
      } else {
        stats.success = (stats.success || 0) + 1;
      }
      await supabase.from("automations").update({ stats }).eq("id", automation.id);

      totalExecuted++;
    }

    console.log(`Automations executed: ${totalExecuted}`);
    return json({ success: true, executed: totalExecuted });
  } catch (e) {
    console.error("automation-execute error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ── Recursive flow executor ──────────────────────────────────
async function executeFromNode(
  supabase: any,
  flow: FlowData,
  nodeId: string,
  ctx: ExecutionContext,
  visited: Set<string>
) {
  if (visited.has(nodeId)) return; // prevent loops
  visited.add(nodeId);

  const node = flow.nodes.find((n) => n.id === nodeId);
  if (!node) return;

  const nodeType = node.data.nodeType as string;

  // Skip trigger nodes (already evaluated)
  if (!nodeType.startsWith("trigger_")) {
    const nodeStart = Date.now();
    let result: any = false;
    let nodeError: string | undefined;
    try {
      result = await executeNode(supabase, node, ctx);
    } catch (err) {
      nodeError = err instanceof Error ? err.message : "Unknown error";
    }
    const nodeDuration = Date.now() - nodeStart;

    // Node label map for logging
    const labelMap: Record<string, string> = {
      condition_contains: "Contém Texto", condition_tag: "Tem Tag", condition_time: "Horário",
      condition_business_hours: "Verificar Expediente",
      condition_contact_field: "Campo do Contato", condition_media_type: "Tipo de Mídia",
      condition_intent_classifier: "Classificar Intenção",
      action_send_message: "Enviar Mensagem",
      action_send_template: "Enviar Template", action_add_tag: "Adicionar Tag",
      action_remove_tag: "Remover Tag", action_assign_agent: "Atribuir Atendente",
      action_move_funnel: "Mover no Funil", action_delay: "Aguardar",
      action_set_variable: "Definir Variável", action_update_score: "Atualizar Score",
      action_http_webhook: "HTTP Webhook", action_llm_reply: "Resposta IA",
      action_elevenlabs_tts: "Áudio ElevenLabs", action_ab_split: "Split A/B",
      action_collect_messages: "Aguardar & Agrupar", action_transcribe_audio: "Transcrever Áudio",
      action_extract_pdf: "Extrair Texto PDF", action_send_interactive: "Mensagem Interativa",
      action_send_media: "Enviar Mídia", action_register_occurrence: "Registrar Ocorrência",
      action_analyze_image: "Analisar Imagem", action_search_product: "Buscar Produto",
      action_verify_payment: "Verificar Comprovante PIX",
      action_escalate_human: "Escalonar p/ Humano",
      action_notify_group: "Notificar Grupo",
    };

    // Build result object for logging
    let logResult: any = undefined;
    if (nodeType.startsWith("condition_")) {
      logResult = { condition: typeof result === "object" ? result?.condition ?? !!result : !!result };
    } else if (result && typeof result === "object") {
      logResult = result;
    }

    ctx.nodeLog.push({
      nodeId: node.id,
      nodeType,
      nodeLabel: labelMap[nodeType] || nodeType,
      status: nodeError ? "error" : "success",
      result: logResult,
      error: nodeError,
      startedAt: new Date(nodeStart).toISOString(),
      durationMs: nodeDuration,
    });

    if (nodeError) throw new Error(nodeError);

    // For condition nodes, follow yes/no paths
    if (nodeType.startsWith("condition_")) {
      const handle = result ? "yes" : "no";
      // Also follow default (bottom) handle
      const nextEdges = flow.edges.filter(
        (e) => e.source === nodeId && (e.sourceHandle === handle || (!e.sourceHandle && handle === "yes"))
      );
      for (const edge of nextEdges) {
        await executeFromNode(supabase, flow, edge.target, ctx, visited);
      }
      return;
    }
  }

  // Follow all outgoing edges from bottom handle
  const nextEdges = flow.edges.filter(
    (e) => e.source === nodeId && (!e.sourceHandle || e.sourceHandle === null)
  );
  for (const edge of nextEdges) {
    await executeFromNode(supabase, flow, edge.target, ctx, visited);
  }
}

// ── Execute a single node ────────────────────────────────────
async function executeNode(
  supabase: any,
  node: FlowNode,
  ctx: ExecutionContext
): Promise<any> {
  const type = node.data.nodeType as string;
  const d = node.data;

  try {
    // ── CONDITIONS ──
    if (type === "condition_contains") {
      const texts = String(d.text || "").split(",").map((t: string) => t.trim().toLowerCase()).filter(Boolean);
      const content = d.case_sensitive ? ctx.messageContent : ctx.messageContent.toLowerCase();
      const searchTexts = d.case_sensitive ? texts.map((t: string) => t) : texts;
      return searchTexts.some((t: string) => content.includes(t));
    }

    if (type === "condition_tag") {
      const tagName = String(d.tag_name || "").trim().toLowerCase();
      if (!tagName) return false;
      const { data: tags } = await supabase
        .from("tags")
        .select("id")
        .ilike("name", tagName);
      if (!tags || tags.length === 0) return false;
      const tagIds = tags.map((t: any) => t.id);
      const { data: contactTags } = await supabase
        .from("contact_tags")
        .select("tag_id")
        .eq("contact_id", ctx.contactId)
        .in("tag_id", tagIds);
      return (contactTags?.length || 0) > 0;
    }

    if (type === "condition_time") {
      const now = new Date();
      const tz = "America/Sao_Paulo";
      const formatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
      const dayFormatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
      const currentTime = formatter.format(now);
      const dayMap: Record<string, number> = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const currentDay = dayMap[dayFormatter.format(now)] || 0;

      const startTime = d.start_time || "00:00";
      const endTime = d.end_time || "23:59";
      const days = String(d.days || "1,2,3,4,5,6,7").split(",").map((x: string) => parseInt(x.trim())).filter(Boolean);

      if (!days.includes(currentDay)) return false;
      return currentTime >= startTime && currentTime <= endTime;
    }

    if (type === "condition_business_hours") {
      // Load business hours config from settings
      // Find automation owner to get their settings
      const { data: autoData } = await supabase
        .from("automations")
        .select("created_by")
        .limit(1)
        .single();

      let bhConfig: any = null;
      if (autoData?.created_by) {
        const { data: settingsRow } = await supabase
          .from("settings")
          .select("value")
          .eq("user_id", autoData.created_by)
          .eq("key", "business_hours")
          .single();
        bhConfig = settingsRow?.value;
      }

      if (!bhConfig || !bhConfig.enabled) {
        console.log("Business hours not configured or disabled, defaulting to open");
        return true;
      }

      const tz = bhConfig.timezone || "America/Sao_Paulo";
      const now = new Date();
      const formatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
      const dayFormatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
      const currentTime = formatter.format(now);
      const dayMap: Record<string, number> = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const currentDayNum = dayMap[dayFormatter.format(now)] || 0;

      const dayKey = String(currentDayNum);
      const daySchedule = bhConfig.days?.[dayKey];

      if (!daySchedule || !daySchedule.enabled) {
        const outMsg = d.out_of_hours_message || bhConfig.outOfHoursMessage;
        if (outMsg) {
          const interpolated = outMsg
            .replace(/\{\{nome\}\}/gi, ctx.contactName)
            .replace(/\{\{phone\}\}/gi, ctx.contactPhone);
          await sendWhatsAppMessage(supabase, ctx, interpolated);
        }
        return false;
      }

      // Support multi-shift format (shifts array) and legacy single-shift (start/end)
      const shifts: Array<{ start: string; end: string }> = Array.isArray(daySchedule.shifts)
        ? daySchedule.shifts
        : [{ start: daySchedule.start || "00:00", end: daySchedule.end || "23:59" }];

      const isWithin = shifts.some((s: any) => currentTime >= s.start && currentTime <= s.end);

      if (!isWithin) {
        const outMsg = d.out_of_hours_message || bhConfig.outOfHoursMessage;
        if (outMsg) {
          const interpolated = outMsg
            .replace(/\{\{nome\}\}/gi, ctx.contactName)
            .replace(/\{\{phone\}\}/gi, ctx.contactPhone);
          await sendWhatsAppMessage(supabase, ctx, interpolated);
        }
      }
      return isWithin;
    }

    if (type === "condition_contact_field") {
      const { data: contact } = await supabase
        .from("contacts")
        .select("name, email, phone, about")
        .eq("id", ctx.contactId)
        .single();
      if (!contact) return false;
      const fieldVal = String(contact[d.field as string] || "");
      const op = d.operator || "exists";
      const compareVal = String(d.value || "").toLowerCase();
      if (op === "exists") return !!fieldVal;
      if (op === "not_exists") return !fieldVal;
      if (op === "contains") return fieldVal.toLowerCase().includes(compareVal);
      if (op === "equals") return fieldVal.toLowerCase() === compareVal;
      return false;
    }

    if (type === "condition_intent_classifier") {
      const intentsRaw = String(d.intents || "dúvida, reclamação, compra, suporte, saudação, falar_com_humano");
      const intents = intentsRaw.split(",").map((i: string) => i.trim().toLowerCase()).filter(Boolean);
      const threshold = parseInt(d.confidence_threshold) || 60;
      const customPrompt = d.custom_prompt || "";
      // The FIRST intent in the list is the "positive" intent (yes path)
      const positiveIntent = intents[0] || "";

      // Use grouped messages + current message for better classification
      const groupedMessages = ctx.variables["mensagens_agrupadas"] || "";
      const classifyContent = groupedMessages || ctx.messageContent || "";

      const classifyPrompt = `Você é um classificador de intenções de mensagens de clientes da Nutricar Brasil (mini mercados autônomos 24h).
Classifique a mensagem do cliente em UMA das seguintes intenções: ${intents.join(", ")}.
Considere: reconhecimento facial, acesso bloqueado, totem de pagamento, cobrança indevida, produto vencido, divergência em compra, sugestão, elogio, pagamento, PIX.

IMPORTANTE sobre "falar_com_humano": Classifique como esta intenção quando o cliente expressa desejo de falar com uma pessoa real, atendente, humano, gerente, supervisor ou similar. Exemplos: "quero falar com alguém", "me transfere", "cadê o atendente", "preciso de um humano", "não quero falar com robô", "passa pra alguém de verdade", "quero falar com uma pessoa", "atendente por favor", "tem alguém aí?", "quero falar com o responsável".

${customPrompt ? `Contexto adicional: ${customPrompt}` : ""}

Responda APENAS com um JSON válido no formato:
{"intent": "<intenção>", "confidence": <0-100>}

Mensagem do cliente: "${classifyContent.slice(0, 500)}"`;

      let reply = "";
      const { keys: intentKeys } = await getUserAIKeys(supabase, ctx.userId);

      if (intentKeys.openai || intentKeys.gemini) {
        reply = await callAIWithUserKeys(intentKeys, classifyPrompt, { maxTokens: 100, temperature: 0.1 });
      }

      if (!reply) {
        ctx.variables["intencao"] = intents[0] || "desconhecido";
        ctx.variables["intencao_confianca"] = "0";
        return true;
      }

      // Parse JSON response
      try {
        const jsonMatch = reply.match(/\{[^}]+\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const detectedIntent = String(parsed.intent || "").toLowerCase().trim();
          const confidence = parseInt(parsed.confidence) || 0;

          ctx.variables["intencao"] = detectedIntent;
          ctx.variables["intencao_confianca"] = String(confidence);

          // YES path = first intent detected with HIGH confidence
          // NO path = any other intent or low confidence
          const isPositive = detectedIntent === positiveIntent && confidence >= threshold;
          console.log(`Intent classified: "${detectedIntent}" (${confidence}%) positive="${positiveIntent}" match=${isPositive} threshold=${threshold}%`);

          // ── AUTO-ESCALATE: If intent is "falar_com_humano" with high confidence, auto-trigger escalation ──
          if (detectedIntent === "falar_com_humano" && confidence >= threshold) {
            console.log(`[ESCALATE-AUTO] Intent "falar_com_humano" detected (${confidence}%) — triggering auto-escalation`);
            ctx.variables["_intent_escalate"] = "true";
            ctx.variables["intencao"] = "falar_com_humano";
            ctx.variables["intencao_confianca"] = String(confidence);

            // Auto-escalate: send transfer message, assign agent, update conversation
            await autoEscalateToHuman(supabase, ctx);
          }

          return isPositive;
        }
      } catch (e) {
        console.error("Intent parse error:", e, "raw:", reply);
      }

      ctx.variables["intencao"] = "desconhecido";
      ctx.variables["intencao_confianca"] = "0";
      return false;
    }

    // ── ACTIONS ──
    if (type === "action_send_message") {
      const message = interpolate(String(d.message || ""), ctx);
      if (!message) return { sent: false, reason: "empty_message" };
      const sendResult = await sendWhatsAppMessage(supabase, ctx, message);
      return { sent: true, ...sendResult };
    }

    if (type === "action_send_interactive") {
      const interactiveType = d.interactive_type || "buttons";
      let bodyText = interpolate(String(d.body_text || ""), ctx);
      const footer = interpolate(String(d.footer || ""), ctx);
      const buttonTitle = interpolate(String(d.button_title || "Ver opções"), ctx);
      const optionsRaw = String(d.options || "").trim();

      if (!bodyText || !optionsRaw) return { sent: false, reason: "empty_body_or_options" };

      // ── DIFFICULTY GUARD: If customer reports a PROBLEM, don't send PIX interactive — send empathy + qualification ──
      const customerContextInteractive = [
        ctx.messageContent,
        ctx.variables["mensagens_agrupadas"] || "",
        ctx.variables["transcricao"] || "",
      ].join(" ");
      const isDifficultyInteractive = PIX_DIFFICULTY_KEYWORDS.test(customerContextInteractive);
      const isExplicitPixInteractive = PIX_EXPLICIT_REQUEST.test(customerContextInteractive);
      // Check BOTH the template body AND the customer context for payment-related content
      const isPaymentMsg = /pix|pagamento|pagar|valor|chave/i.test(bodyText) || /pix|pagamento|pagar|valor|chave/i.test(customerContextInteractive);

      // ── CHECK: Did the customer state a specific value? If so, skip difficulty guard and let PIX buttons flow ──
      const valuePatternInteractive = /(?:R\$\s*|valor\s*(?:é|de|:)?\s*(?:R\$\s*)?|pagar\s*(?:R\$\s*)?|total\s*(?:é|de|:)?\s*(?:R\$\s*)?)([\d]+[.,][\d]{2}|[\d]+)/i;
      const valueMatchInteractive = customerContextInteractive.match(valuePatternInteractive);
      const customerValueInteractive = valueMatchInteractive ? parseFloat(valueMatchInteractive[1].replace(",", ".")) : null;
      const hasCustomerValueInteractive = customerValueInteractive !== null && Number.isFinite(customerValueInteractive) && customerValueInteractive > 0;

      if (isDifficultyInteractive && !isExplicitPixInteractive && isPaymentMsg && !hasCustomerValueInteractive) {
        // Customer has a PROBLEM and did NOT state a value — ask for details
        console.log(`[PIX GUARD] Difficulty detected WITHOUT value — converting to AI qualification message`);
        ctx.variables["_difficulty_detected"] = "true";
        ctx.variables["_audit_reply_suppressed"] = `Mensagem interativa PIX bloqueada — relato de dificuldade: "${ctx.messageContent?.slice(0, 100)}"`;
        
        // Use AI to generate a context-aware qualification message
        const { keys: guardKeys } = await getUserAIKeys(supabase, ctx.userId);
        
        // Build conversation context for qualification
        let qualConversation = "";
        try {
          let qualQuery = supabase
            .from("messages")
            .select("direction, content, type, created_at")
            .eq("contact_id", ctx.contactId)
            .order("created_at", { ascending: false })
            .limit(10);
          if (ctx.sessionStartedAt) qualQuery = qualQuery.gte("created_at", ctx.sessionStartedAt);
          const { data: qualMsgs } = await qualQuery;
          if (qualMsgs?.length) {
            qualConversation = qualMsgs
              .reverse()
              .filter((m: any) => m.content?.trim())
              .map((m: any) => `[${m.direction === "inbound" ? "Cliente" : "Atendente"}]: ${m.content}`)
              .join("\n");
          }
        } catch {}

        let qualificationMsg = "";
        
        if ((guardKeys.openai || guardKeys.gemini) && qualConversation) {
          const qualPrompt = `Você é uma atendente simpática da Nutricar Brasil (mini mercados autônomos 24h).

O cliente está relatando um PROBLEMA com pagamento. Você precisa entender melhor a situação ANTES de oferecer a chave PIX.

HISTÓRICO DA CONVERSA:
${qualConversation}

MENSAGEM ATUAL DO CLIENTE: "${ctx.messageContent}"

REGRAS:
- Demonstre empatia genuína pelo problema com tom acolhedor
- NÃO envie chave PIX ainda
- Pergunte SOMENTE os detalhes que AINDA NÃO foram informados na conversa
- Se o cliente JÁ disse a loja/unidade, NÃO pergunte novamente — use o nome na resposta
- Se o cliente JÁ disse o produto, NÃO pergunte novamente

FORMATAÇÃO (WhatsApp — OBRIGATÓRIO):
- Use *negrito* para destacar informações importantes
- Use _itálico_ para tom empático ou assinaturas
- Use emojis variados e expressivos (3-5 por mensagem): 😔💚📸🔍✨💰 etc.
- Separe cada ideia com quebra de linha para facilitar leitura no celular
- Use listas com emojis numerados (1️⃣ 2️⃣) quando pedir mais de uma informação

INSTRUÇÃO PRINCIPAL:
- SEMPRE peça ao cliente para enviar uma 📸 *foto do código de barras* do produto
- Destaque *código de barras* em negrito SEMPRE
- Explique de forma amigável que com o código de barras conseguimos buscar o preço certinho 🔍 e enviar a *chave PIX* 💰
- Máximo 4-5 frases curtas e bem espaçadas
- Termine com: _Nutricar Brasil - Mini Mercado 24h_ 💚

Responda APENAS com o texto da mensagem.`;

          qualificationMsg = await callAIWithUserKeys(guardKeys, qualPrompt, { maxTokens: 300, temperature: 0.7 });
        }
        
        // Fallback if AI fails — try to detect store from conversation to avoid re-asking
        if (!qualificationMsg) {
          const knownStore = qualConversation.match(/(?:unidade|loja)\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+)*)/i)?.[1] || "";
          if (knownStore) {
            qualificationMsg = `😔 _Poxa, que chato isso na unidade ${knownStore}!_\n\nFica tranquilo(a) que vou te ajudar! ✨\n\nEnvie uma 📸 *foto do código de barras* do produto pra eu buscar o preço certinho no sistema 🔍\n\nAssim já te passo a *chave PIX* pra pagamento! 💰\n\n_Nutricar Brasil - Mini Mercado 24h_ 💚`;
          } else {
            qualificationMsg = `😔 _Poxa, sinto muito pelo transtorno!_\n\nVou te ajudar a resolver isso rapidinho! ✨\n\nPreciso só de duas coisinhas:\n\n1️⃣ Em qual *unidade* aconteceu?\n2️⃣ Uma 📸 *foto do código de barras* do produto\n\nCom isso consigo buscar o preço 🔍 e te enviar a *chave PIX*! 💰\n\n_Nutricar Brasil - Mini Mercado 24h_ 💚`;
          }
        }
        
        await sendWhatsAppMessage(supabase, ctx, qualificationMsg);
        return { sent: true, difficulty_guard: true, reason: "difficulty_report_detected" };
      }

      // ── DIFFICULTY + VALUE STATED: Customer has a problem BUT already told us the value — send PIX buttons directly ──
      if (isDifficultyInteractive && hasCustomerValueInteractive && isPaymentMsg) {
        const valueFmt = customerValueInteractive!.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        console.log(`[PIX GUARD] Difficulty detected WITH value ${valueFmt} — sending PIX buttons with customer-stated value`);
        
        const offerMsg = `💰 Valor informado: *${valueFmt}*\n\nDeseja receber a chave PIX para pagamento desse valor? 😊`;
        const sent = await sendInteractiveButtons(supabase, ctx, offerMsg, [
          { label: "✅ Enviar chave PIX", id: "pix_enviar" },
          { label: "❌ Não, obrigado", id: "pix_cancelar" },
        ], "Nutricar Brasil - Mini Mercado 24h");
        
        ctx.variables["_pix_buttons_sent"] = "true";
        return { sent, difficulty_with_value: true, value: valueFmt };
      }

      // ── CHECK: Did the customer say they ALREADY PAID? ──
      const alreadyPaidPattern = /j[aá]\s*(fiz|paguei|pago|transferi|enviei)|fiz\s*o\s*pi[x]|fiz\s*o\s*pagamento|t[aá]\s*pago|realizei\s*o\s*pagamento|fiz\s*a\s*transfer[eê]ncia/i;
      const customerAlreadyPaid = alreadyPaidPattern.test(ctx.messageContent);
      const pixAlreadySent = ctx.variables["_pix_key_sent"] === "true";

      if (customerAlreadyPaid && pixAlreadySent) {
        // Customer says they already paid AND we already sent the PIX key — ask for receipt
        bodyText = "Ótimo! 😊 Para confirmar seu pagamento, por favor envie o comprovante do PIX aqui. Assim que recebermos, vamos validar rapidinho! 💚\n\n_Nutricar Brasil - Mini Mercado 24h_";
        console.log(`[PIX] Customer says already paid & PIX key was already sent — asking for receipt instead of resending`);
        ctx.variables["_audit_reply_suppressed"] = `PIX key NOT resent — customer said "${ctx.messageContent}", asking for comprovante`;
      } else if (customerAlreadyPaid && !pixAlreadySent) {
        // Customer says paid but we haven't sent PIX yet — still ask for receipt (they may have paid via another channel)
        bodyText = "Entendi que você já realizou o pagamento! 😊 Por favor, envie o comprovante do PIX aqui para confirmarmos. 💚\n\n_Nutricar Brasil - Mini Mercado 24h_";
        console.log(`[PIX] Customer says already paid (no prior PIX sent) — asking for receipt`);
        ctx.variables["_audit_reply_suppressed"] = `Customer said "${ctx.messageContent}" — asking for comprovante (no prior PIX sent)`;
      } else if (isPaymentMsg && ctx.userId) {
        // Check if we already have product info from a previous node in THIS execution
        if (ctx.variables["produto_encontrado"] === "true" && ctx.variables["produto_nome"] && ctx.variables["produto_preco"]) {
          const prodName = ctx.variables["produto_nome"];
          const prodPrice = Number(ctx.variables["produto_preco"]).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
          bodyText = `🛒 Produto: *${prodName}*\n💰 Valor: *${prodPrice}*\n\n${bodyText}`;
          console.log(`[PIX] Injected product info from current execution: ${prodName} = ${prodPrice}`);
        } else {
          // ── STEP 1: Check recent OUTBOUND messages for previously identified product ──
          let productRecovered = false;
          try {
            let prodRecoveryQuery = supabase
              .from("messages")
              .select("content")
              .eq("contact_id", ctx.contactId)
              .eq("direction", "outbound")
              .order("created_at", { ascending: false })
              .limit(10);
            if (ctx.sessionStartedAt) prodRecoveryQuery = prodRecoveryQuery.gte("created_at", ctx.sessionStartedAt);
            const { data: recentMsgs } = await prodRecoveryQuery;

            if (recentMsgs && recentMsgs.length > 0) {
              // Look for "🛒 Encontrei no catálogo: *PRODUCT*\n💰 Valor: *R$ XX,XX*" or similar patterns
              const productPattern = /(?:🛒\s*(?:Encontrei no catálogo|Produto):\s*\*([^*]+)\*[\s\S]*?💰\s*Valor:\s*\*R\$\s*([\d.,]+)\*)/;
              for (const msg of recentMsgs) {
                const match = msg.content?.match(productPattern);
                if (match) {
                  const recoveredName = match[1].trim();
                  const recoveredPrice = match[2].trim().replace(",", ".");
                  ctx.variables["produto_encontrado"] = "true";
                  ctx.variables["produto_nome"] = recoveredName;
                  ctx.variables["produto_preco"] = recoveredPrice;
                  const formattedPrice = Number(recoveredPrice).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
                  bodyText = `🛒 Produto: *${recoveredName}*\n💰 Valor: *${formattedPrice}*\n\n${bodyText}`;
                  console.log(`[PIX] Recovered product from recent messages: ${recoveredName} = ${formattedPrice}`);
                  productRecovered = true;
                  break;
                }
              }
            }
          } catch (e) {
            console.error("[PIX] Error recovering product from recent messages:", e);
          }

          // ── STEP 2: If not recovered, try searching from conversation context ──
          if (!productRecovered) {
            const grouped = ctx.variables["mensagens_agrupadas"] || "";
            const transcription = ctx.variables["transcricao"] || "";
            const imageProduct = ctx.variables["produto_identificado"] || ctx.variables["descricao_imagem"] || "";
            const searchText = imageProduct || grouped || transcription || ctx.messageContent || "";

            // Check if the message is ONLY a PIX request with no product context
            const isOnlyPixRequest = PIX_EXPLICIT_REQUEST.test(ctx.messageContent || "") && !imageProduct && !grouped && !transcription;

            if (isOnlyPixRequest) {
              // Customer just said "envia a chave pix" — don't search with garbage, ask nicely
              bodyText = `⚠️ Para seguir com o pagamento, preciso confirmar qual produto você pegou. Por favor, envie uma *foto do código de barras* do produto para eu consultar o valor. 📸\n\n${bodyText}`;
              console.log(`[PIX] Explicit PIX request but no product context — asking client to send barcode`);
            } else if (searchText.length > 2) {
              try {
                const stopWords = new Set(["para", "como", "quero", "saber", "qual", "esse", "essa", "favor", "pode", "aqui", "mais", "muito", "obrigado", "obrigada", "sobre", "tenho", "estou", "esta", "isso", "peguei", "produto", "valor", "preco", "pagar", "pagamento", "chave", "paguei", "pago", "transferi", "enviar", "envie", "envia", "mandar", "manda", "mande", "quiser", "quer"]);
                const words = searchText
                  .replace(/[^\p{L}\p{N}\s]/gu, " ")
                  .split(/\s+/)
                  .filter((w: string) => w.length > 3 && !stopWords.has(w.toLowerCase()));
                const query = words.slice(0, 5).join(" ");
                
                if (query.length > 2) {
                  const { data: products } = await supabase.rpc("search_products", {
                    _user_id: ctx.userId,
                    _query: query,
                    _limit: 3,
                  });
                  if (products && products.length > 0) {
                    const first = products[0];
                    ctx.variables["produto_encontrado"] = "true";
                    ctx.variables["produto_nome"] = first.name || "";
                    ctx.variables["produto_preco"] = String(first.price || 0);
                    const prodPrice = Number(first.price).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
                    bodyText = `🛒 Produto: *${first.name}*\n💰 Valor: *${prodPrice}*\n\n${bodyText}`;
                    console.log(`[PIX] Auto-searched product: ${first.name} = ${prodPrice} (query: "${query}")`);
                  } else {
                    bodyText = `⚠️ Não consegui identificar o produto no sistema. Por favor, envie uma *foto do código de barras* do produto para eu consultar o valor correto e te enviar a chave PIX. 📸\n\n${bodyText}`;
                    console.log(`[PIX] No product found for query: "${query}" — asking client to send barcode`);
                  }
                } else {
                  bodyText = `⚠️ Para seguir com o pagamento, envie uma *foto do código de barras* do produto para eu consultar o valor e te enviar a chave PIX. 📸\n\n${bodyText}`;
                  console.log(`[PIX] No search query available — asking client to send barcode`);
                }
              } catch (e) {
                console.error("[PIX] Product search error:", e);
              }
            } else {
              bodyText = `⚠️ Para seguir com o pagamento, envie uma *foto do código de barras* do produto para eu consultar o valor e te enviar a chave PIX. 📸\n\n${bodyText}`;
              console.log(`[PIX] No context for product search — asking client to send barcode`);
            }
          }
        }
      }

      const lines = optionsRaw.split("\n").map((l: string) => l.trim()).filter(Boolean);

      // Get WhatsApp instance (cached)
      const instance = await getCachedInstance(supabase, ctx.userId, ctx.instanceId);
      if (!instance) {
        throw new Error("Instância WhatsApp não configurada");
      }

      const cleanNumber = String(ctx.contactPhone || "").replace(/\D/g, "");
      const baseUrl = String(instance.base_url).replace(/\/+$/, "");

      // Build UazAPI /send/menu payload
      const optionStrings = lines.map((line: string) => {
        const parts = line.split("|").map((p: string) => p.trim());
        // Format: título|id or título|id|descrição
        return parts.join("|");
      });

      const payload: Record<string, any> = {
        number: cleanNumber,
        text: bodyText,
        choices: optionStrings,
      };

      if (interactiveType === "buttons") {
        payload.type = "button";
      } else {
        payload.type = "list";
        payload.listButton = buttonTitle;
      }

      if (footer) payload.footerText = footer;

      const resp = await fetch(`${baseUrl}/send/menu`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          token: instance.instance_token,
        },
        body: JSON.stringify(payload),
      });

      const rawResponse = await resp.text();
      let result: any = {};
      try { result = rawResponse ? JSON.parse(rawResponse) : {}; } catch { result = { raw: rawResponse }; }

      if (!resp.ok || result?.error) {
        throw new Error(result?.error || `Falha no envio interativo (HTTP ${resp.status})`);
      }

      // Save to messages table
      const contentPreview = `[${interactiveType === "buttons" ? "Botões" : "Lista"}] ${bodyText.slice(0, 100)}`;
      await supabase.from("messages").insert({
        contact_id: ctx.contactId,
        direction: "outbound",
        type: "interactive",
        content: contentPreview,
        status: "sent",
        metadata: { interactive_type: interactiveType, options: optionStrings, footer, source: "automation" },
      });

      console.log(`Sent interactive (${interactiveType}) to ${cleanNumber}: ${optionStrings.length} options`);
      return { sent: true, type: interactiveType, options: optionStrings.length };
    }

    if (type === "action_send_media") {
      const mediaType = d.media_type || "image";
      const mediaUrl = interpolate(String(d.media_url || ""), ctx);
      const caption = interpolate(String(d.caption || ""), ctx);
      const fileName = interpolate(String(d.file_name || ""), ctx);

      if (!mediaUrl) return { sent: false, reason: "empty_media_url" };

      // Get WhatsApp instance (cached)
      const instance = await getCachedInstance(supabase, ctx.userId, ctx.instanceId);
      if (!instance) {
        throw new Error("Instância WhatsApp não configurada");
      }

      const cleanNumber = String(ctx.contactPhone || "").replace(/\D/g, "");
      const baseUrl = String(instance.base_url).replace(/\/+$/, "");

      // Map media type to UazAPI endpoint
      const endpointMap: Record<string, string> = {
        image: "/send/image",
        video: "/send/video",
        audio: "/send/audio",
        document: "/send/document",
      };
      const endpoint = endpointMap[mediaType] || "/send/image";

      const payload: Record<string, any> = {
        number: cleanNumber,
        url: mediaUrl,
      };
      if (caption) payload.caption = caption;
      if (mediaType === "document" && fileName) payload.fileName = fileName;

      const resp = await fetch(`${baseUrl}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          token: instance.instance_token,
        },
        body: JSON.stringify(payload),
      });

      const rawResponse = await resp.text();
      let result: any = {};
      try { result = rawResponse ? JSON.parse(rawResponse) : {}; } catch { result = { raw: rawResponse }; }

      if (!resp.ok || result?.error) {
        const reason = result?.error || `Falha no envio de mídia (HTTP ${resp.status})`;
        console.error(`[MEDIA SEND] ${reason}. Falling back to text message.`);

        // Fallback: send caption as plain text so automation can continue
        if (caption) {
          await sendWhatsAppMessage(supabase, ctx, caption);
          return { sent: false, fallback: "text", reason };
        }

        // No caption to fallback, but do not crash whole flow
        return { sent: false, reason };
      }

      // Save to messages table
      await supabase.from("messages").insert({
        contact_id: ctx.contactId,
        direction: "outbound",
        type: mediaType,
        content: caption || null,
        media_url: mediaUrl,
        status: "sent",
        metadata: { source: "automation" },
      });

      console.log(`Sent ${mediaType} to ${cleanNumber}: ${mediaUrl.slice(0, 80)}`);
      return { sent: true, mediaType, mediaUrl };
    }

    if (type === "action_send_template") {
      const templateName = String(d.template_name || "").trim();
      const { data: template } = await supabase
        .from("templates")
        .select("content")
        .ilike("name", templateName)
        .single();
      if (template) {
        const message = interpolate(template.content, ctx);
        const sendResult = await sendWhatsAppMessage(supabase, ctx, message);
        return { sent: true, template: templateName, ...sendResult };
      }
      return { sent: false, reason: "template_not_found", template: templateName };
    }

    if (type === "action_add_tag") {
      const tagName = String(d.tag_name || "").trim();
      if (!tagName) return true;
      // Find or create tag
      let { data: tag } = await supabase.from("tags").select("id").ilike("name", tagName).single();
      if (!tag) {
        const { data: newTag } = await supabase.from("tags").insert({ name: tagName }).select("id").single();
        tag = newTag;
      }
      if (tag) {
        await supabase.from("contact_tags").upsert({ contact_id: ctx.contactId, tag_id: tag.id }, { onConflict: "contact_id,tag_id" });
      }
      return true;
    }

    if (type === "action_remove_tag") {
      const tagName = String(d.tag_name || "").trim();
      const { data: tag } = await supabase.from("tags").select("id").ilike("name", tagName).single();
      if (tag) {
        await supabase.from("contact_tags").delete().eq("contact_id", ctx.contactId).eq("tag_id", tag.id);
      }
      return true;
    }

    if (type === "action_assign_agent") {
      const agentEmail = String(d.agent_email || "").trim();
      if (!agentEmail) return true;
      const { data: profile } = await supabase.from("profiles").select("user_id").eq("email", agentEmail).single();
      if (profile) {
        await supabase.from("conversations").update({ assigned_to: profile.user_id }).eq("id", ctx.conversationId);
      }
      return true;
    }

    if (type === "action_escalate_human") {
      const transferMsg = interpolate(String(d.transfer_message || "Estou transferindo você para um de nossos atendentes. Aguarde um momento! 😊"), ctx);
      const assignmentMode = String(d.assignment_mode || "auto");
      const agentEmail = String(d.agent_email || "").trim();
      const setPriority = String(d.set_priority || "high");
      const addTag = String(d.add_tag || "").trim();
      const pauseAutomations = d.pause_automations !== false;

      // 1. Send transfer message to the client
      const instance = await getCachedInstance(supabase, ctx.userId, ctx.instanceId);
      if (instance && transferMsg) {
        try {
          const sendUrl = `${instance.base_url}/send/text`;
          await fetch(sendUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${instance.instance_token}` },
            body: JSON.stringify({ phone: ctx.contactPhone, message: transferMsg }),
          });
          // Save outbound message
          await supabase.from("messages").insert({
            contact_id: ctx.contactId || null,
            user_id: ctx.userId,
            content: transferMsg,
            type: "text",
            direction: "outbound",
            status: "sent",
            metadata: { source: "automation" },
          });
        } catch (sendErr) {
          console.error("[ESCALATE] Failed to send transfer message:", sendErr);
        }
      }

      // 2. Assign to agent based on mode
      let assignedToId: string | null = null;

      if (assignmentMode === "specific" && agentEmail) {
        const { data: profile } = await supabase.from("profiles").select("user_id").eq("email", agentEmail).maybeSingle();
        if (profile) assignedToId = profile.user_id;
      } else if (assignmentMode === "auto") {
        // Find agent with lowest active conversation count
        const { data: agents } = await supabase
          .from("profiles")
          .select("user_id, name")
          .neq("role", "user");

        if (agents && agents.length > 0) {
          let minLoad = Infinity;
          let bestAgent: string | null = null;

          for (const agent of agents) {
            const { count } = await supabase
              .from("conversations")
              .select("id", { count: "exact", head: true })
              .eq("assigned_to", agent.user_id)
              .in("status", ["open", "in_progress", "waiting"]);
            const load = count || 0;
            if (load < minLoad) {
              minLoad = load;
              bestAgent = agent.user_id;
            }
          }
          assignedToId = bestAgent;
        }
      }
      // mode === "none" → don't assign, leave in general queue

      // 3. Update conversation: assign, set priority, change status
      // IMPORTANT: Preserve pending_occurrence flag in notes if it exists
      const convUpdate: Record<string, any> = {
        status: "waiting",
      };
      if (assignedToId) convUpdate.assigned_to = assignedToId;
      if (setPriority !== "keep") convUpdate.priority = setPriority;

      await supabase.from("conversations").update(convUpdate).eq("id", ctx.conversationId);

      // 4. Add escalation tag
      if (addTag && ctx.contactId) {
        // Upsert tag
        const { data: existingTag } = await supabase.from("tags").select("id").ilike("name", addTag).maybeSingle();
        let tagId: string;
        if (existingTag) {
          tagId = existingTag.id;
        } else {
          const { data: newTag } = await supabase.from("tags").insert({ name: addTag, color: "#ef4444", created_by: ctx.userId }).select("id").single();
          tagId = newTag?.id;
        }
        if (tagId) {
          await supabase.from("contact_tags").upsert({ contact_id: ctx.contactId, tag_id: tagId }, { onConflict: "contact_id,tag_id" });
        }
      }

      // 5. Set variable to pause further automations in this execution
      if (pauseAutomations) {
        ctx.variables["_escalated_to_human"] = "true";
        ctx.variables["_escalated_at"] = new Date().toISOString();
        if (assignedToId) ctx.variables["_escalated_agent_id"] = assignedToId;
      }

      console.log(`[ESCALATE] Conversation ${ctx.conversationId} escalated to human. Mode=${assignmentMode}, Agent=${assignedToId || "queue"}, Priority=${setPriority}`);
      return { escalated: true, assignedTo: assignedToId, mode: assignmentMode };
    }

    // ── NOTIFY GROUP NODE ──
    if (type === "action_notify_group") {
      const groupId = interpolate(String(d.group_id || ""), ctx).trim();
      if (!groupId) return { sent: false, reason: "missing_group_id" };

      // Filter by occurrence type if configured
      const onlyTypes = String(d.only_types || "").split(",").map((t: string) => t.trim().toLowerCase()).filter(Boolean);
      if (onlyTypes.length > 0) {
        const currentType = (ctx.variables["tipo_ocorrencia"] || ctx.variables["occurrence_type"] || "").toLowerCase();
        if (!onlyTypes.some(t => currentType.includes(t))) {
          console.log(`[NOTIFY_GROUP] Skipping — type "${currentType}" not in filter: ${onlyTypes.join(", ")}`);
          return { sent: false, reason: "type_filtered", currentType };
        }
      }

      // ── Auto-populate missing variables from available context ──
      // loja: from custom_fields.condominio, or try to detect from conversation
      if (!ctx.variables["loja"]) {
        let loja = "";
        // Priority 1: detect from current conversation text (most accurate for THIS interaction)
        const textPool = [
          ctx.variables["transcricao"] || "",
          ctx.variables["mensagens_agrupadas"] || "",
          ctx.messageContent || "",
        ].join(" ");
        
        console.log(`[NOTIFY_GROUP] textPool for loja detection (first 300): "${textPool.slice(0, 300)}"`);
        
        // Match patterns like: "loja do Alphavita", "loja H-Ville", "unidade Central Park"
        // Use word boundaries — stop at connectors (e, não, mas, que, está, tá, aqui, eu, etc.)
        const stopWords = "e|eu|não|nao|está|esta|tá|ta|tem|mas|porém|porem|que|aqui|onde|porque|por|com|sem|um|uma|uns|umas|o|a|os|as|no|na|do|da|de|ele|ela|meu|minha|esse|essa|este|esta|se|já|ja|só|so|muito|como|quando|então|entao|aí|ai|lá|la|pra|para";
        const lojaPatterns = [
          new RegExp(`(?:loja|unidade|condom[ií]nio)\\s+(?:d[oae]\\s+)?([A-ZÀ-Úa-zà-ú][\\w\\-']+(?:[\\s\\-][A-ZÀ-Ú][\\w\\-']*){0,2})(?:\\s+(?:${stopWords})|\\s*[,.]|$)`, "i"),
          new RegExp(`(?:aqui\\s+n[oa]\\s+|n[oa]\\s+)([A-ZÀ-Ú][\\w\\-']+(?:[\\s\\-][A-ZÀ-Ú][\\w\\-']*){0,2})(?:\\s+(?:${stopWords})|\\s*[,.]|$)`, "i"),
        ];
        
        for (const pat of lojaPatterns) {
          const m = textPool.match(pat);
          if (m?.[1]) {
            const rawCandidate = m[1].trim();
            const cleaned = rawCandidate
              .replace(/^(?:aqui\s+)?(?:do|da|de|no|na)\s+/i, "")
              .replace(/[.,;:!?]+$/g, "")
              .trim();

            const stopTokens = new Set(["e","eu","não","nao","está","esta","tá","ta","tem","mas","porém","porem","que","aqui","onde","porque","por","com","sem","um","uma","uns","umas","o","a","os","as","no","na","do","da","de","ele","ela","meu","minha","esse","essa","este","se","já","ja","só","so","muito","como","quando","então","entao","aí","ai","lá","la","pra","para"]);
            const candidateTokens: string[] = [];
            for (const token of cleaned.split(/\s+/).filter(Boolean)) {
              const low = token.toLowerCase();
              if (stopTokens.has(low) && candidateTokens.length > 0) break;
              if (!stopTokens.has(low)) candidateTokens.push(token);
              if (candidateTokens.length >= 4) break;
            }
            const candidate = candidateTokens.join(" ").trim();

            if (candidate.length > 1) {
              loja = candidate;
              console.log(`[NOTIFY_GROUP] Detected loja from text: "${loja}" (raw: "${rawCandidate}")`);
              break;
            }
          }
        }

        // Priority 2: fallback to saved profile data
        if (!loja && ctx.contactId) {
          const { data: cp } = await supabase.from("contacts").select("custom_fields").eq("id", ctx.contactId).single();
          const cf = (cp?.custom_fields as Record<string, any>) || {};
          loja = cf.condominio || cf.loja || cf.unidade || "";
          if (loja) console.log(`[NOTIFY_GROUP] Loja from profile fallback: "${loja}"`);
        }
        ctx.variables["loja"] = loja || "Não identificada";
      }

      // descricao: prefer transcription > grouped messages > image description > message content
      if (!ctx.variables["descricao"]) {
        const desc = ctx.variables["transcricao"]
          || ctx.variables["mensagens_agrupadas"]
          || ctx.variables["descricao_imagem"]
          || (ctx.messageContent && !ctx.messageContent.startsWith("[") && !ctx.messageContent.startsWith("http") ? ctx.messageContent : null)
          || "Sem descrição";
        // Truncate to 200 chars for group notification
        ctx.variables["descricao"] = desc.length > 200 ? desc.slice(0, 200) + "..." : desc;
      }

      // tipo_ocorrencia: from classify intent node result
      if (!ctx.variables["tipo_ocorrencia"]) {
        ctx.variables["tipo_ocorrencia"] = ctx.variables["intencao"] || ctx.variables["occurrence_type"] || ctx.variables["intent"] || "não classificado";
      }

      console.log(`[NOTIFY_GROUP] Variables: loja="${ctx.variables["loja"]}", descricao="${(ctx.variables["descricao"] || "").slice(0, 80)}...", tipo="${ctx.variables["tipo_ocorrencia"]}"`);

      const messageTemplate = interpolate(String(d.message_template || "🚨 Alerta: {{descricao}}"), ctx);
      const mentionNumbersRaw = interpolate(String(d.mention_numbers || ""), ctx);
      const mentionNumbers = mentionNumbersRaw.split(",").map((n: string) => n.trim().replace(/\D/g, "")).filter(Boolean);

      // Build message with @mentions
      let finalMessage = messageTemplate;
      if (mentionNumbers.length > 0) {
        const mentionTags = mentionNumbers.map((n: string) => `@${n}`).join(" ");
        finalMessage = `${messageTemplate}\n\n${mentionTags}`;
      }

      // Send to group via UazAPI
      const instance = await getCachedInstance(supabase, ctx.userId, ctx.instanceId);
      if (!instance) {
        throw new Error("Instância WhatsApp não configurada");
      }

      const baseUrl = String(instance.base_url).replace(/\/+$/, "");
      // UazAPI /send/text always requires "number" field — for groups use the JID as number
      const sendBody: Record<string, any> = { number: groupId, text: finalMessage };

      // Add mentions for UazAPI to properly tag users in group
      if (mentionNumbers.length > 0) {
        sendBody.mentioned = mentionNumbers.map((n: string) => `${n}@s.whatsapp.net`);
      }

      console.log(`[NOTIFY_GROUP] Sending to ${groupId}, payload: ${JSON.stringify(sendBody).slice(0, 500)}`);

      const resp = await fetch(`${baseUrl}/send/text`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          token: instance.instance_token,
        },
        body: JSON.stringify(sendBody),
      });

      const rawResponse = await resp.text();
      let result: any = {};
      try { result = rawResponse ? JSON.parse(rawResponse) : {}; } catch { result = { raw: rawResponse }; }

      if (!resp.ok || result?.error) {
        throw new Error(result?.error || `Falha ao notificar grupo (HTTP ${resp.status})`);
      }

      console.log(`[NOTIFY_GROUP] Sent to group ${groupId} with ${mentionNumbers.length} mentions`);
      return { sent: true, groupId, mentions: mentionNumbers.length };
    }

    if (type === "action_move_funnel") {
      const funnelName = String(d.funnel_name || "").trim();
      const stageName = String(d.stage_name || "").trim();
      if (!funnelName) return true;
      const { data: funnel } = await supabase.from("funnels").select("id").ilike("name", funnelName).single();
      if (!funnel) return true;
      const updateData: Record<string, any> = { funnel_id: funnel.id };
      if (stageName) {
        const { data: stage } = await supabase
          .from("funnel_stages")
          .select("id")
          .eq("funnel_id", funnel.id)
          .ilike("name", stageName)
          .single();
        if (stage) updateData.funnel_stage_id = stage.id;
      }
      await supabase.from("conversations").update(updateData).eq("id", ctx.conversationId);
      return true;
    }

    if (type === "action_delay") {
      const duration = parseInt(d.duration) || 0;
      const unit = d.unit || "seconds";
      let ms = duration * 1000;
      if (unit === "minutes") ms = duration * 60 * 1000;
      if (unit === "hours") ms = duration * 3600 * 1000;
      if (unit === "days") ms = duration * 86400 * 1000;
      // Cap at 25 seconds (edge function timeout limit)
      ms = Math.min(ms, 25000);
      if (ms > 0) await new Promise((r) => setTimeout(r, ms));
      return true;
    }

    if (type === "action_set_variable") {
      ctx.variables[d.variable_name || ""] = interpolate(String(d.variable_value || ""), ctx);
      return true;
    }

    if (type === "action_update_score") {
      const points = parseInt(d.points) || 0;
      const op = d.operation || "add";
      const { data: conv } = await supabase
        .from("conversations")
        .select("score")
        .eq("id", ctx.conversationId)
        .single();
      let newScore = conv?.score || 0;
      if (op === "add") newScore += points;
      else if (op === "subtract") newScore -= points;
      else if (op === "set") newScore = points;
      await supabase.from("conversations").update({ score: newScore }).eq("id", ctx.conversationId);
      return true;
    }

    if (type === "action_register_occurrence") {
      // ── HYBRID: Flag for deferred AND try immediate registration if conversation has enough context ──
      try {
        const defaultType = d.occurrence_type || "reclamacao";
        const priority = d.priority || "normal";

        if (!ctx.conversationId) {
          console.warn("[OCCURRENCE] No conversationId available, cannot register");
          return { flagged: false, reason: "no_conversation" };
        }

        // Always save the pending_occurrence flag (backup for auto-close)
        await supabase
          .from("conversations")
          .update({
            notes: JSON.stringify({
              pending_occurrence: true,
              default_type: defaultType,
              default_priority: priority,
              flagged_at: new Date().toISOString(),
            }),
          })
          .eq("id", ctx.conversationId);

        // ── Try IMMEDIATE registration using AI analysis of conversation so far ──
        const { keys: occKeys } = await getUserAIKeys(supabase, ctx.userId);
        if (!occKeys.openai && !occKeys.gemini) {
          console.log(`[OCCURRENCE] No AI keys — deferred only`);
          return { flagged: true, deferred: true };
        }

        // Load conversation messages
        let msgQuery = supabase
          .from("messages")
          .select("direction, content, type, created_at")
          .eq("contact_id", ctx.contactId)
          .order("created_at", { ascending: false })
          .limit(40);
        if (ctx.sessionStartedAt) msgQuery = msgQuery.gte("created_at", ctx.sessionStartedAt);
        const { data: convMessages } = await msgQuery;

        if (!convMessages || convMessages.length < 2) {
          console.log(`[OCCURRENCE] Not enough messages yet — deferred only`);
          return { flagged: true, deferred: true };
        }

        const conversationContext = (convMessages || [])
          .reverse()
          .filter((m: any) => m.content?.trim())
          .map((m: any) => `[${m.direction === "inbound" ? "Cliente" : "Atendente"}]: ${m.content}`)
          .join("\n");

        // Also include transcription and grouped messages
        const extraContext = [
          ctx.variables["transcricao"] ? `[Transcrição de áudio]: ${ctx.variables["transcricao"]}` : "",
          ctx.variables["mensagens_agrupadas"] ? `[Mensagens agrupadas]: ${ctx.variables["mensagens_agrupadas"]}` : "",
          ctx.variables["descricao_imagem"] ? `[Descrição de imagem]: ${ctx.variables["descricao_imagem"]}` : "",
        ].filter(Boolean).join("\n");

        const { data: contactData } = await supabase
          .from("contacts")
          .select("phone, name, custom_fields")
          .eq("id", ctx.contactId)
          .single();

        const contactName = contactData?.name || ctx.contactName || "Não informado";
        const contactPhone = contactData?.phone || ctx.contactPhone;
        const savedStore = (contactData?.custom_fields as any)?.condominio || "";
        const confirmedStore = ctx.variables["loja"] || savedStore || "";

        const extractPrompt = `Você é um analisador de conversas de atendimento da Nutricar Brasil (rede de mini mercados autônomos 24h).

Analise a conversa abaixo e determine se há informações SUFICIENTES para registrar uma ocorrência.

CRITÉRIOS PARA "ready: true" — TODOS devem ser atendidos:
1. O cliente descreveu CLARAMENTE qual é o problema (não basta dizer "tenho um problema")
2. A IA já fez as perguntas de qualificação necessárias (qual produto, o que aconteceu, etc.)
3. O cliente respondeu com detalhes suficientes

CRITÉRIOS PARA "ready: false":
- Cliente só mencionou o problema de forma vaga sem detalhes
- A IA ainda está coletando informações
- Faltam dados essenciais (ex: cliente disse "produto com problema" mas não disse QUAL produto nem O QUE aconteceu)
- Conversa é apenas cumprimento/saudação

TIPOS DE OCORRÊNCIA: elogio, reclamacao, furto, falta_produto, produto_vencido, loja_suja, problema_pagamento, loja_sem_energia, acesso_bloqueado, sugestao, duvida, outro

PRIORIDADE:
- alta (furto, produto vencido, loja sem energia, cobrança indevida, acesso bloqueado)
- normal (reclamações gerais, problemas de pagamento, falta de produto, dúvidas)
- baixa (elogios, sugestões, feedback positivo)

DADOS DO CONTATO:
- Nome: "${contactName}"
- Telefone: ${contactPhone}
- Loja confirmada: ${confirmedStore || "Não confirmada"}

CONVERSA:
${conversationContext.slice(0, 4000)}
${extraContext ? "\n" + extraContext.slice(0, 1000) : ""}

Responda APENAS com JSON válido:
{
  "ready": true/false,
  "reason": "motivo se não está pronto (ex: 'cliente não informou qual produto')",
  "store_name": "nome da loja ou Não informada",
  "contact_name": "nome do cliente",
  "type": "tipo da ocorrência",
  "priority": "alta/normal/baixa",
  "summary": "Resumo COMPLETO com todos os detalhes coletados. Max 5 frases."
}`;

        const aiReply = await callAIWithUserKeys(occKeys, extractPrompt, { maxTokens: 500, temperature: 0.1, timeoutMs: 15000 });

        if (aiReply) {
          const jsonMatch = aiReply.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[0]);
              
              if (!parsed.ready) {
                console.log(`[OCCURRENCE] AI says not ready: ${parsed.reason || "insufficient info"} — keeping deferred flag`);
                return { flagged: true, deferred: true, reason: parsed.reason };
              }

              // Dedup check
              const dedupCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
              const { data: recentOcc } = await supabase
                .from("occurrences")
                .select("id")
                .eq("contact_phone", contactPhone)
                .gte("created_at", dedupCutoff)
                .limit(1);

              if (recentOcc?.length) {
                console.log(`[OCCURRENCE] Dedup: skipping, recent occurrence exists`);
                return { flagged: true, deferred: false, deduplicated: true };
              }

              const storeName = parsed.store_name || confirmedStore || "Não informada";
              const occContactName = parsed.contact_name || contactName;
              const validTypes = ["elogio", "reclamacao", "furto", "falta_produto", "produto_vencido", "loja_suja", "problema_pagamento", "loja_sem_energia", "acesso_bloqueado", "sugestao", "duvida", "outro"];
              const occType = validTypes.includes(parsed.type) ? parsed.type : defaultType;
              const occPriority = ["alta", "normal", "baixa"].includes(parsed.priority) ? parsed.priority : priority;
              const description = parsed.summary || conversationContext.slice(0, 500);

              const { error: occErr } = await supabase.from("occurrences").insert({
                store_name: storeName,
                type: occType,
                description,
                contact_phone: contactPhone || null,
                contact_name: occContactName || null,
                priority: occPriority,
                status: "aberto",
                created_by: ctx.userId || null,
              });

              if (occErr) {
                console.error(`[OCCURRENCE] Insert error:`, occErr.message);
                return { flagged: true, deferred: true, insertError: occErr.message };
              }

              console.log(`[OCCURRENCE] ✅ Registered immediately: store="${storeName}", type="${occType}", priority="${occPriority}"`);

              // Save store on contact profile
              if (storeName && storeName !== "Não informada") {
                try {
                  const cf = (contactData?.custom_fields as Record<string, any>) || {};
                  if (cf.condominio !== storeName) {
                    await supabase.from("contacts").update({ custom_fields: { ...cf, condominio: storeName } }).eq("id", ctx.contactId);
                  }
                } catch {}
              }

              // Save contact name
              if (occContactName && occContactName !== "Não informado" && occContactName !== contactPhone) {
                try {
                  await supabase.from("contacts").update({ name: occContactName }).eq("id", ctx.contactId);
                } catch {}
              }

              // Clear the pending flag since we registered immediately
              await supabase.from("conversations").update({ notes: null }).eq("id", ctx.conversationId);

              return { flagged: false, registered: true, storeName, type: occType, priority: occPriority };
            } catch (parseErr) {
              console.error(`[OCCURRENCE] JSON parse error:`, parseErr);
            }
          }
        }

        console.log(`[OCCURRENCE] AI analysis inconclusive — keeping deferred flag`);
        return { flagged: true, deferred: true };
      } catch (e) {
        console.error("[OCCURRENCE] Error:", e);
        return { flagged: false, reason: "error", error: e instanceof Error ? e.message : "unknown" };
      }
    }

    if (type === "action_http_webhook") {
      const url = interpolate(String(d.url || ""), ctx);
      const method = d.method || "POST";
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      try {
        const extraHeaders = JSON.parse(d.headers || "{}");
        Object.assign(headers, extraHeaders);
      } catch { /* ignore parse errors */ }
      const bodyTemplate = interpolate(d.body_template || JSON.stringify({
        phone: ctx.contactPhone,
        name: ctx.contactName,
        message: ctx.messageContent,
      }), ctx);
      await fetch(url, { method, headers, body: bodyTemplate });
      return true;
    }

    if (type === "action_llm_reply") {
      const systemPrompt = interpolate(String(d.system_prompt || "Você é um assistente de atendimento."), ctx);
      const provider = d.provider || "openai";
      const model = d.model || (provider === "openai" ? "gpt-4o-2024-11-20" : "gemini-2.5-flash");
      const maxTokens = parseInt(d.max_tokens) || 2048;

      // Get user API keys
      const { data: ownerAutomation } = await supabase
        .from("automations")
        .select("created_by")
        .limit(1)
        .single();

      if (!ownerAutomation?.created_by) return { sent: false, reason: "no_owner" };

      const { data: settings } = await supabase
        .from("settings")
        .select("key, value")
        .eq("user_id", ownerAutomation.created_by)
        .in("key", ["llm_openai", "llm_gemini", "ai_timeout", "ai_audio_reply"]);

      const keys: Record<string, string> = {};
      let aiTimeoutSeconds = 15; // default 15s for automations (fast fallback)
      let aiAudioReplyEnabled = false;
      for (const s of (settings || [])) {
        const val = s.value as any;
        if (s.key === "llm_openai" && val?.apiKey) keys.openai = val.apiKey;
        if (s.key === "llm_gemini" && val?.apiKey) keys.gemini = val.apiKey;
        if (s.key === "ai_timeout" && val?.seconds) aiTimeoutSeconds = val.seconds;
        if (s.key === "ai_audio_reply") aiAudioReplyEnabled = val === true || val?.enabled === true;
      }

      // ── Whisper: transcribe last inbound audio ──
      if (model === "whisper-1") {
        // Find last audio message from contact
        const { data: audioMsgs } = await supabase
          .from("messages")
          .select("media_url, type")
          .eq("contact_id", ctx.contactId)
          .eq("direction", "inbound")
          .in("type", ["audio", "ptt"])
          .order("created_at", { ascending: false })
          .limit(1);

        const audioUrl = audioMsgs?.[0]?.media_url;
        if (!audioUrl) {
          await sendWhatsAppMessage(supabase, ctx, interpolate(systemPrompt || "Não encontrei nenhum áudio para transcrever.", ctx));
          return { sent: true, model, action: "whisper_no_audio" };
        }

        // Download audio
        const audioResp = await fetch(audioUrl);
        if (!audioResp.ok) return { sent: false, reason: "audio_download_failed" };
        const audioBlob = await audioResp.blob();

        let transcription = "";

        // Try Whisper first
        if (keys.openai) {
          const formData = new FormData();
          formData.append("file", audioBlob, "audio.ogg");
          formData.append("model", "whisper-1");
          formData.append("language", "pt");

          const whisperResp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${keys.openai}` },
            body: formData,
          });

          if (whisperResp.ok) {
            const result = await whisperResp.json();
            transcription = result.text || "";
          } else {
            console.error(`Whisper failed (${whisperResp.status}), trying ElevenLabs STT fallback`);
          }
        }

        // Fallback to ElevenLabs STT
        if (!transcription) {
          let elevenlabsKey = "";
          if (ctx.userId) {
            const { data: elS } = await supabase.from("settings").select("value").eq("user_id", ctx.userId).eq("key", "elevenlabs").single();
            elevenlabsKey = (elS?.value as any)?.apiKey || "";
          }
          if (!elevenlabsKey) elevenlabsKey = Deno.env.get("ELEVENLABS_API_KEY") || "";

          if (elevenlabsKey) {
            console.log("Using ElevenLabs STT fallback for Whisper model");
            const elFormData = new FormData();
            elFormData.append("file", audioBlob, "audio.ogg");
            elFormData.append("model_id", "scribe_v2");
            elFormData.append("language_code", "por");

            const elResp = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
              method: "POST",
              headers: { "xi-api-key": elevenlabsKey },
              body: elFormData,
            });
            if (elResp.ok) {
              const elResult = await elResp.json();
              transcription = elResult.text || "";
              console.log(`ElevenLabs STT result: "${transcription.slice(0, 80)}"`);
            } else {
              const elErr = await elResp.text();
              console.error(`ElevenLabs STT also failed (${elResp.status}): ${elErr.slice(0, 200)}`);
            }
          }
        }

        if (transcription) {
          transcription = normalizeTranscription(transcription);
          const replyText = systemPrompt
            ? interpolate(systemPrompt.replace(/\{\{transcricao\}\}/gi, transcription), ctx)
            : `Transcrição: ${transcription}`;
          await sendWhatsAppMessage(supabase, ctx, replyText);
          return { sent: true, model, transcription: transcription.slice(0, 100) };
        }

        return { sent: false, reason: "transcription_failed_all_providers" };
      }

      // ── DALL-E: generate image ──
      if (model === "dall-e-3" || model === "dall-e-2") {
        if (!keys.openai) return { sent: false, reason: "openai_key_missing" };
        const prompt = interpolate(systemPrompt, ctx);
        const imageResp = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: { Authorization: `Bearer ${keys.openai}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            prompt,
            n: 1,
            size: model === "dall-e-3" ? "1024x1024" : "512x512",
            response_format: "url",
          }),
        });

        if (imageResp.ok) {
          const result = await imageResp.json();
          const imageUrl = result.data?.[0]?.url;
          if (imageUrl) {
            await sendWhatsAppImage(supabase, ctx, imageUrl, prompt.slice(0, 100));
            return { sent: true, model, imageUrl: imageUrl.slice(0, 80) };
          }
        }
        const errText = await imageResp.text();
        throw new Error(`DALL-E error (${imageResp.status}): ${errText.slice(0, 200)}`);
      }

      // ── TTS: text to speech ──
      if (model === "tts-1" || model === "tts-1-hd") {
        if (!keys.openai) return { sent: false, reason: "openai_key_missing" };
        const text = interpolate(systemPrompt, ctx);
        const ttsResp = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: { Authorization: `Bearer ${keys.openai}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            input: text,
            voice: "nova",
            response_format: "mp3",
          }),
        });

        if (ttsResp.ok) {
          const audioBuffer = await ttsResp.arrayBuffer();
          const { encode: base64Encode } = await import("https://deno.land/std@0.168.0/encoding/base64.ts");
          const audioBase64 = base64Encode(audioBuffer);
          await sendWhatsAppAudio(supabase, ctx, audioBase64);
          return { sent: true, model, action: "tts_sent" };
        }
        const errText = await ttsResp.text();
        throw new Error(`TTS error (${ttsResp.status}): ${errText.slice(0, 200)}`);
      }

      // ── Imagen 3 (Google): generate image via Gemini ──
      if (model === "imagen-3") {
        if (!keys.gemini) return { sent: false, reason: "gemini_key_missing" };
        const prompt = interpolate(systemPrompt, ctx);
        // Use Gemini's image generation endpoint
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${keys.gemini}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              instances: [{ prompt }],
              parameters: { sampleCount: 1, aspectRatio: "1:1" },
            }),
          }
        );
        if (resp.ok) {
          const result = await resp.json();
          const b64Image = result.predictions?.[0]?.bytesBase64Encoded;
          if (b64Image) {
            // Upload to storage and send
            const fileName = `imagen_${Date.now()}.png`;
            const imageBytes = Uint8Array.from(atob(b64Image), c => c.charCodeAt(0));
            const { data: upload } = await supabase.storage
              .from("chat-media")
              .upload(`generated/${fileName}`, imageBytes, { contentType: "image/png" });
            if (upload?.path) {
              const { data: urlData } = supabase.storage.from("chat-media").getPublicUrl(upload.path);
              await sendWhatsAppImage(supabase, ctx, urlData.publicUrl, prompt.slice(0, 100));
              return { sent: true, model, action: "imagen_sent" };
            }
          }
        }
        const errText = await resp.text();
        console.error(`Imagen error: ${errText.slice(0, 300)}`);
        return { sent: false, model, reason: "imagen_failed" };
      }

      // ── Gemini Pro Vision: analyze last image ──
      if (model === "gemini-pro-vision") {
        if (!keys.gemini) return { sent: false, reason: "gemini_key_missing" };
        // Find last image message
        const { data: imgMsgs } = await supabase
          .from("messages")
          .select("media_url, type")
          .eq("contact_id", ctx.contactId)
          .eq("direction", "inbound")
          .eq("type", "image")
          .order("created_at", { ascending: false })
          .limit(1);

        const imageUrl = imgMsgs?.[0]?.media_url;
        if (!imageUrl) {
          await sendWhatsAppMessage(supabase, ctx, "Não encontrei nenhuma imagem para analisar.");
          return { sent: true, model, action: "vision_no_image" };
        }

        // Download image and convert to base64
        const imgResp = await fetch(imageUrl);
        if (!imgResp.ok) return { sent: false, reason: "image_download_failed" };
        const imgBuffer = await imgResp.arrayBuffer();
        const { encode: base64Encode } = await import("https://deno.land/std@0.168.0/encoding/base64.ts");
        const imgBase64 = base64Encode(imgBuffer);

        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${keys.gemini}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: interpolate(systemPrompt, ctx) }] },
              contents: [{
                role: "user",
                parts: [
                  { text: ctx.messageContent || "Analise esta imagem." },
                  { inline_data: { mime_type: "image/jpeg", data: imgBase64 } },
                ],
              }],
              generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
            }),
          }
        );
        if (resp.ok) {
          const result = await resp.json();
          const reply = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
          if (reply) await sendWhatsAppMessage(supabase, ctx, reply);
          return { sent: !!reply, model, action: "vision_analyzed" };
        }
        const errText = await resp.text();
        throw new Error(`Vision error: ${errText.slice(0, 200)}`);
      }

      // ══════════════════════════════════════════════════════════
      // ── HANDLE STORE BUTTON RESPONSES ──
      // ══════════════════════════════════════════════════════════
      const msgTrimmed = (ctx.messageContent || "").trim().toLowerCase();
      // Only match button IDs or explicit button text patterns — NOT bare "sim"
      const isStoreYes = /^store_yes_/i.test(msgTrimmed) || /^✅\s*sim/i.test(msgTrimmed);
      const isStoreNo = msgTrimmed === "store_change" || /^❌\s*n[ãa]o/i.test(msgTrimmed);

      // Stop words to validate pendingStore extraction
      const storeStopWords = new Set(["no","na","da","do","de","que","para","por","com","em","um","uma","os","as","ou","sim","não","nao","aqui","loja","unidade","condominio","condomínio","problema","produto","acesso","acessar"]);

      // Only handle as store button if there was a RECENT store confirmation message (within 5 min)
      if (isStoreYes || isStoreNo) {
        let pendingStore = "";
        try {
          const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
          const { data: recentInt } = await supabase
            .from("messages")
            .select("content, created_at")
            .eq("contact_id", ctx.contactId)
            .eq("direction", "outbound")
            .eq("type", "interactive")
            .gte("created_at", fiveMinAgo)
            .order("created_at", { ascending: false })
            .limit(3);
          for (const msg of recentInt || []) {
            // Match the confirmation button format: "📍 Você está na unidade *StoreName*?"
            const sm = (msg.content || "").match(/está\s+na\s+unidade\s+\*([^*]+)\*/i);
            if (sm?.[1]) {
              const candidate = sm[1].trim();
              // Validate: not a stop word and minimum length
              if (candidate.length > 2 && !storeStopWords.has(candidate.toLowerCase())) {
                pendingStore = candidate;
                break;
              }
            }
          }
        } catch {}

        if (pendingStore && isStoreYes) {
          ctx.variables["_store_confirmed"] = "true";
          ctx.variables["loja"] = pendingStore;
          try {
            const { data: cp } = await supabase.from("contacts").select("custom_fields").eq("id", ctx.contactId).single();
            const cf = (cp?.custom_fields as Record<string, any>) || {};
            cf.condominio = pendingStore;
            await supabase.from("contacts").update({ custom_fields: cf }).eq("id", ctx.contactId);
          } catch {}
          await sendWhatsAppMessage(supabase, ctx, `✅ Perfeito, unidade *${pendingStore}* confirmada! 👍`);
          await new Promise((r) => setTimeout(r, 1000 + Math.random() * 800));
          await sendWhatsAppMessage(supabase, ctx, "Me conta, como posso te ajudar? 😊");
          console.log(`[STORE CONFIRM] Store "${pendingStore}" confirmed and saved`);
          return { sent: true, model, storeConfirmed: pendingStore };
        }

        if (pendingStore && isStoreNo) {
          ctx.variables["_store_confirmed"] = "false";
          await sendWhatsAppMessage(supabase, ctx, "Sem problema! Em qual das nossas unidades você está? 📍");
          return { sent: true, model, storeChangeRequested: true };
        }
      }

      // ══════════════════════════════════════════════════════════

      // ── 1. CONVERSATION MEMORY: load broader history (15 msgs) ──
      // Filter by session boundary to avoid mixing resolved conversations
      let inboundQuery = supabase
        .from("messages")
        .select("direction, content, type, media_url, created_at")
        .eq("contact_id", ctx.contactId)
        .eq("direction", "inbound")
        .order("created_at", { ascending: false })
        .limit(10);
      if (ctx.sessionStartedAt) inboundQuery = inboundQuery.gte("created_at", ctx.sessionStartedAt);
      const { data: recentInbound } = await inboundQuery;

      let outboundQuery = supabase
        .from("messages")
        .select("direction, content, type, created_at")
        .eq("contact_id", ctx.contactId)
        .eq("direction", "outbound")
        .order("created_at", { ascending: false })
        .limit(5);
      if (ctx.sessionStartedAt) outboundQuery = outboundQuery.gte("created_at", ctx.sessionStartedAt);
      const { data: recentOutbound } = await outboundQuery;

      const transcription = ctx.variables["transcricao"] || "";
      const pdfContent = ctx.variables["pdf_conteudo"] || "";
      const groupedMessages = ctx.variables["mensagens_agrupadas"] || "";

      // ── 2. CONTACT PROFILE: load known info to avoid re-asking ──
      const { data: contactProfile } = await supabase
        .from("contacts")
        .select("name, phone, email, about, custom_fields")
        .eq("id", ctx.contactId)
        .single();

      // Load contact tags for context
      let contactTags: string[] = [];
      try {
        const { data: tagLinks } = await supabase
          .from("contact_tags")
          .select("tag_id")
          .eq("contact_id", ctx.contactId);
        if (tagLinks?.length) {
          const { data: tagRows } = await supabase
            .from("tags")
            .select("name")
            .in("id", tagLinks.map((t: any) => t.tag_id));
          contactTags = (tagRows || []).map((t: any) => t.name);
        }
      } catch {}

      // Load conversation metadata (score, priority, notes)
      const { data: convMeta } = await supabase
        .from("conversations")
        .select("score, priority, notes, status, created_at, unread_count")
        .eq("id", ctx.conversationId)
        .single();

      // ── 3. PRODUCT CATALOG: use pre-fetched data OR search dynamically ──
      const msgForProductSearch = groupedMessages || transcription || ctx.messageContent || "";
      let productContext = "";
      const imageDesc = ctx.variables["descricao_imagem"] || "";
      const imageProductId = ctx.variables["produto_identificado"] || "";
      
      // Check if a previous search_product node already populated catalog data
      if (ctx.variables["produto_encontrado"] === "true" && ctx.variables["produtos_lista"]) {
        productContext = "\n\n📦 PRODUTOS ENCONTRADOS NO CATÁLOGO (dados reais — USE ESTES PREÇOS, não invente valores):\n" +
          ctx.variables["produtos_lista"] +
          "\n\n⚠️ OBRIGATÓRIO: Use EXATAMENTE os preços listados acima. NÃO invente, arredonde ou altere valores. Se o cliente perguntar sobre um produto que NÃO está na lista acima, diga que vai verificar.";
        console.log("[LLM CONTEXT] Using pre-fetched product data from search_product node");
      } else {
        // Determine search query: prioritize image identification, then message text
        let searchQuery = "";
        
        // If image was analyzed and product identified, search by that
        if (imageProductId) {
          searchQuery = imageProductId;
          console.log(`[LLM CONTEXT] Searching catalog by image-identified product: "${imageProductId}"`);
        } else if (imageDesc) {
          // Extract product name from image description
          searchQuery = imageDesc.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).slice(0, 5).join(" ");
          console.log(`[LLM CONTEXT] Searching catalog by image description: "${searchQuery}"`);
        }
        
        // Also check message text for product keywords
        if (!searchQuery) {
          const productKeywords = /produ|preço|preco|valor|quanto|custa|comprar|item|estoque|barcode|código|codigo|peguei|levei|comprei/i;
          if (productKeywords.test(msgForProductSearch) && ctx.userId) {
            const stopWords = new Set(["para", "como", "quero", "saber", "qual", "esse", "essa", "favor", "pode", "aqui", "mais", "muito", "obrigado", "obrigada", "vocês", "voces", "sobre", "tenho", "estou", "esta", "isso", "peguei", "esse", "produto"]);
            const words = msgForProductSearch
              .replace(/[^\p{L}\p{N}\s]/gu, " ")
              .split(/\s+/)
              .filter((w: string) => w.length > 3 && !stopWords.has(w.toLowerCase()));
            searchQuery = words.slice(0, 5).join(" ");
          }
        }
        
        // Execute catalog search if we have a query
        if (searchQuery && searchQuery.length > 2 && ctx.userId) {
          try {
            const { data: products } = await supabase.rpc("search_products", {
              _user_id: ctx.userId,
              _query: searchQuery,
              _limit: 5,
            });
            if (products && products.length > 0) {
              // Also set ctx variables so downstream nodes (PIX, etc.) can use them
              const first = products[0];
              ctx.variables["produto_encontrado"] = "true";
              ctx.variables["produto_nome"] = first.name || "";
              ctx.variables["produto_preco"] = String(first.price || 0);
              ctx.variables["produto_categoria"] = first.category || "";
              ctx.variables["produto_barcode"] = first.barcode || "";
              ctx.variables["produtos_lista"] = products.map((p: any, i: number) => {
                const pf = Number(p.price || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
                return `${i + 1}. *${p.name}* — ${pf}${p.category ? ` (${p.category})` : ""}${p.barcode ? ` | Cód: ${p.barcode}` : ""}`;
              }).join("\n");
              
              productContext = "\n\n📦 PRODUTOS ENCONTRADOS NO CATÁLOGO (dados reais — USE ESTES PREÇOS, não invente valores):\n" +
                products.map((p: any) => 
                  `- ${p.name}${p.barcode ? ` (cód: ${p.barcode})` : ""}: R$ ${Number(p.price).toFixed(2)}${p.category ? ` [${p.category}]` : ""}`
                ).join("\n") +
                "\n\n⚠️ OBRIGATÓRIO: Use EXATAMENTE os preços listados acima. NÃO invente, arredonde ou altere valores.";
              console.log(`[LLM CONTEXT] Dynamic search found ${products.length} products for "${searchQuery}"`);
            } else {
              console.log(`[LLM CONTEXT] No products found for "${searchQuery}"`);
            }
          } catch (e) {
            console.error("[PRODUCT SEARCH] Error:", e);
          }
        }
      }
      
      // Always add anti-hallucination instruction for prices
      if (!productContext) {
        productContext = "\n\n🚫 PREÇOS: Você NÃO tem acesso ao catálogo de produtos neste momento. Se o cliente perguntar sobre preço ou valor de qualquer produto, NUNCA invente um valor. Peça para enviar uma 📸 *foto do código de barras* do produto para que o sistema possa consultar o valor no catálogo. JAMAIS diga 'vou verificar' ou 'vou consultar' — isso cria expectativa de resposta que não virá. Sempre PEÇA a foto do código de barras diretamente.";
      }

      // ── 4. SENTIMENT ANALYSIS + TONE ADAPTATION: detect emotional tone and communication style ──
      let sentimentHint = "";
      const msgLower = (msgForProductSearch).toLowerCase();
      const frustrationWords = /absurdo|raiva|indignado|revoltado|péssimo|pessimo|horrível|horrivel|lixo|vergonha|nunca mais|inaceitável|inaceitavel|porcaria|merda|droga|irritad|cansad|farto|decepcion|desrespeito|descaso|abuso/;
      const urgencyWords = /urgente|emergência|emergencia|socorro|ajuda|desesper|imediato|agora|já|rápido|rapido/;
      const satisfactionWords = /obrigad|agradeço|agradeco|maravilh|excelente|parabéns|parabens|perfeito|ótimo|otimo|adorei|amei|feliz|satisfeit|top|nota 10/;
      const confusionWords = /não entendi|nao entendi|como funciona|não sei|nao sei|confus|explica|ajuda|perdid/;

      if (frustrationWords.test(msgLower)) {
        sentimentHint = "\n⚠️ SENTIMENTO DETECTADO: FRUSTRAÇÃO/RAIVA. Adote tom ultra-empático: reconheça o sentimento, peça desculpas sinceras, demonstre urgência em resolver. NÃO minimize a situação. Use frases como 'Entendo completamente sua frustração', 'Você tem toda razão em estar chateado(a)'.";
      } else if (urgencyWords.test(msgLower)) {
        sentimentHint = "\n⚡ SENTIMENTO DETECTADO: URGÊNCIA. Responda com agilidade, seja direto e prático. Mostre que está priorizando o caso. Use frases como 'Vou resolver isso agora mesmo', 'Prioridade total para o seu caso'.";
      } else if (satisfactionWords.test(msgLower)) {
        sentimentHint = "\n😊 SENTIMENTO DETECTADO: SATISFAÇÃO/GRATIDÃO. Responda com calor humano, agradeça o feedback positivo. Use frases como 'Que bom saber disso!', 'Fico muito feliz!'. Aproveite para perguntar se pode ajudar em mais alguma coisa.";
      } else if (confusionWords.test(msgLower)) {
        sentimentHint = "\n🤔 SENTIMENTO DETECTADO: CONFUSÃO/DÚVIDA. Seja didático e paciente. Explique passo a passo. Evite jargões técnicos. Pergunte se ficou claro.";
      }

      // ── 4b. DYNAMIC TONE ADAPTATION: mirror client's communication style ──
      let toneHint = "";
      const allClientText = (groupedMessages || transcription || ctx.messageContent || "");
      // Detect informal vs formal style
      const informalMarkers = /\b(vc|tb|pq|pra|tá|tô|né|blz|vlw|tmj|kk|haha|rs|kkk|mds|slk|mn|mano|cara|véi|vei|pow|poxa|eai|fala|suave)\b/i;
      const formalMarkers = /\b(prezado|senhor|senhora|cordialmente|atenciosamente|gostaria|solicito|informo|gentileza|poderia)\b/i;
      const shortMessages = allClientText.split(/\n/).filter((l: string) => l.trim()).every((l: string) => l.trim().length < 40);
      const usesEmojis = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(allClientText);

      if (formalMarkers.test(allClientText)) {
        toneHint = "\n🎭 ESTILO DO CLIENTE: FORMAL. Adapte seu tom: use linguagem mais polida e profissional. Evite gírias e emojis em excesso. Trate por 'senhor(a)' se apropriado. Mantenha respostas estruturadas.";
      } else if (informalMarkers.test(allClientText) || (shortMessages && usesEmojis)) {
        toneHint = "\n🎭 ESTILO DO CLIENTE: SUPER INFORMAL. Espelhe o tom: use 'vc', 'tá', 'pra', emojis, tom descontraído. Respostas CURTAS (1-2 frases max). Vá direto ao ponto como um amigo faria.";
      } else if (shortMessages) {
        toneHint = "\n🎭 ESTILO DO CLIENTE: DIRETO/OBJETIVO. O cliente usa mensagens curtas. Responda de forma igualmente objetiva: máximo 2 frases. Sem rodeios.";
      }

      // ── 4c. LONG-TERM MEMORY: inject previous conversation summary ──
      let memoryHint = "";
      try {
        const { data: contactMem } = await supabase
          .from("contacts")
          .select("conversation_summary")
          .eq("id", ctx.contactId)
          .single();
        if (contactMem?.conversation_summary) {
          memoryHint = `\n\n🧠 MEMÓRIA DE LONGO PRAZO (resumo de interações anteriores — use para contexto, NÃO mencione diretamente):\n${contactMem.conversation_summary}`;
          console.log(`[MEMORY] Injected long-term memory for contact ${ctx.contactId}: ${contactMem.conversation_summary.slice(0, 80)}`);
        }
      } catch {}

      // ── 4d. FEW-SHOT EXAMPLES: inject high-rated real agent responses ──
      let fewShotHint = "";
      try {
        const { data: goodExamples } = await supabase
          .from("ai_feedback")
          .select("suggestion_text")
          .eq("rating", "positive")
          .order("created_at", { ascending: false })
          .limit(5);
        if (goodExamples && goodExamples.length >= 2) {
          const examples = goodExamples.map((e: any) => `• "${e.suggestion_text}"`).join("\n");
          fewShotHint = `\n\n💡 EXEMPLOS DE BOAS RESPOSTAS (avaliadas positivamente por atendentes reais — use como referência de TOM e ESTILO):\n${examples}\n\nIMPORTANTE: Estes são exemplos de estilo. NÃO copie literalmente. Adapte ao contexto da conversa atual.`;
          console.log(`[FEW-SHOT] Injected ${goodExamples.length} positive examples`);
        }
      } catch {}

      // ── 5. BUILD ENRICHED PROFILE CONTEXT ──
      const profileParts: string[] = [];
      if (contactProfile?.name && contactProfile.name !== "Não informado") profileParts.push(`Nome: ${contactProfile.name}`);
      if (contactProfile?.email) profileParts.push(`Email: ${contactProfile.email}`);
      if (contactProfile?.about) profileParts.push(`Sobre: ${contactProfile.about}`);
      // Include condomínio/unidade from custom_fields if available
      const customFieldsData = (contactProfile?.custom_fields as Record<string, any>) || {};
      if (customFieldsData.condominio) profileParts.push(`Condomínio/Unidade: ${customFieldsData.condominio}`);
      if (contactTags.length > 0) profileParts.push(`Tags: ${contactTags.join(", ")}`);
      if (convMeta?.priority && convMeta.priority !== "normal") profileParts.push(`Prioridade: ${convMeta.priority}`);
      if (convMeta?.notes) profileParts.push(`Notas anteriores: ${convMeta.notes}`);
      if ((convMeta?.score ?? 0) > 0) profileParts.push(`Score: ${convMeta.score}`);

      // ── NEW SESSION AWARENESS ──
      // Determine if this is a fresh session based on boundary + unread volume
      const boundaryTs = ctx.sessionStartedAt ? new Date(ctx.sessionStartedAt).getTime() : (convMeta?.created_at ? new Date(convMeta.created_at).getTime() : 0);
      const now = Date.now();
      const isBoundaryRecent = boundaryTs > 0 && (now - boundaryTs) < (12 * 60 * 60 * 1000);
      const isNewSession = isBoundaryRecent || (convMeta?.unread_count ?? 0) <= 2;
      const newSessionHint = isNewSession
        ? `\n\n🆕 SESSÃO NOVA: Este é um NOVO atendimento deste cliente. Ele pode ter tido problemas anteriores, mas esta é uma conversa NOVA.
- Cumprimente o cliente usando o nome que já conhecemos (se disponível).
- Se temos o condomínio/unidade registrada, CONFIRME com o cliente: "Vc tá na unidade X?" — NÃO assuma automaticamente.
- O cliente pode estar em OUTRA unidade desta vez. Sempre confirme antes de registrar qualquer ocorrência.
- NÃO mencione problemas ou ocorrências de sessões anteriores.
- NÃO assuma que o cliente quer resolver o mesmo problema de antes.
- Trate como uma solicitação 100% nova. Pergunte "como posso ajudar?" de forma aberta.`
        : "";

      const profileContext = profileParts.length > 0
        ? `\n\n👤 PERFIL DO CONTATO (dados já conhecidos):\n${profileParts.join("\n")}\n\n🚫 REGRAS DE DADOS CONHECIDOS:
- Se o NOME do contato já está listado acima, NUNCA peça "nome completo" — use o nome que já temos.
- Se a UNIDADE/LOJA/CONDOMÍNIO já está registrada no perfil: CONFIRME com o cliente antes de usar ("Vc tá na unidade X?"). O cliente pode estar em outra loja desta vez.
- Se o cliente JÁ INFORMOU a loja NESTA CONVERSA, NÃO pergunte novamente.

🔍 REGRA DE CONTEXTO CONVERSACIONAL: Releia TODA a conversa acima antes de responder. Se o cliente já informou QUALQUER dado nesta conversa, considere como já coletado. NUNCA re-pergunte algo que já foi dito nesta sessão.${newSessionHint}`
        : `\n\n🔍 REGRA DE CONTEXTO CONVERSACIONAL: Releia TODA a conversa acima antes de responder. Se o cliente já informou QUALQUER dado nesta conversa, considere como já coletado. NUNCA re-pergunte algo que já foi dito nesta sessão.${newSessionHint}`;

      // ── 6. LANGUAGE DETECTION: adapt tone/language to client ──
      let languageHint = "";
      const langSample = (groupedMessages || transcription || ctx.messageContent || "").trim();
      if (langSample.length > 10) {
        // Simple heuristic: check character patterns and common words
        const spanishWords = /\b(hola|gracias|por favor|quiero|necesito|puede|tiene|buenas|buenos|cómo|como está|señor|señora|estoy|tengo)\b/i;
        const englishWords = /\b(hello|hi|thanks|please|need|want|could|would|should|have|this|that|with|from|about|help|price|how much)\b/i;
        const frenchWords = /\b(bonjour|merci|s'il vous|comment|besoin|voudrais|combien|monsieur|madame)\b/i;
        const italianWords = /\b(ciao|grazie|per favore|buongiorno|vorrei|quanto|signore|signora)\b/i;
        
        const spanishCount = (langSample.match(spanishWords) || []).length;
        const englishCount = (langSample.match(englishWords) || []).length;
        const frenchCount = (langSample.match(frenchWords) || []).length;
        const italianCount = (langSample.match(italianWords) || []).length;
        
        if (englishCount >= 2 || (englishCount >= 1 && !/[áàâãéèêíïóôõöúüçñ]/i.test(langSample))) {
          languageHint = `\n\n🌍 IDIOMA DETECTADO: INGLÊS. O cliente está escrevendo em inglês. Responda INTEIRAMENTE em inglês, mantendo o mesmo tom amigável e profissional. Use contractions naturally (I'm, we'll, you're).`;
          console.log("[LANG] Detected: English");
        } else if (spanishCount >= 2) {
          languageHint = `\n\n🌍 IDIOMA DETECTADO: ESPANHOL. O cliente está escrevendo em espanhol. Responda INTEIRAMENTE em espanhol, com tom amigável. Use "tú" (informal) a menos que o cliente use "usted".`;
          console.log("[LANG] Detected: Spanish");
        } else if (frenchCount >= 1) {
          languageHint = `\n\n🌍 IDIOMA DETECTADO: FRANCÊS. Responda INTEIRAMENTE em francês com tom cordial e profissional.`;
          console.log("[LANG] Detected: French");
        } else if (italianCount >= 1) {
          languageHint = `\n\n🌍 IDIOMA DETECTADO: ITALIANO. Responda INTEIRAMENTE em italiano com tom cordial e profissional.`;
          console.log("[LANG] Detected: Italian");
        }
      }

      // ── 7. RESPONSE VARIATION INSTRUCTION ──
      const variationHint = `\n\n🎭 VARIAÇÃO DE RESPOSTAS:
- NÃO repita a mesma saudação. Varie entre: "Oi", "Olá", "Ei", usar só o nome, ou ir direto ao ponto.
- Se já cumprimentou antes nesta conversa, NÃO cumprimente de novo.
- NUNCA use despedidas genéricas como "Qualquer coisa, estou aqui!", "Fico à disposição", "Estou aqui pra ajudar", "A sua colaboração é importante".
- Seja natural como uma pessoa real conversando no WhatsApp, não como um bot.

🚫 REGRA ANTI-REPETIÇÃO (CRÍTICO):
- Releia TODAS as suas mensagens anteriores nesta conversa.
- Se você JÁ FEZ uma pergunta e o cliente respondeu (mesmo que com algo vago), NÃO repita a mesma pergunta.
- Se o cliente repetiu a mesma mensagem, ele está frustrado — AVANCE no atendimento em vez de repetir a pergunta.
- Se o cliente disse "sim" ou "não" a uma pergunta, interprete a resposta e PROSSIGA.
- Se você perguntou sobre erro na tela e o cliente respondeu qualquer coisa: aceite e avance.
- NUNCA envie a mesma mensagem duas vezes na mesma conversa.

📚 PRIORIDADE DA BASE DE CONHECIMENTO (OBRIGATÓRIO):
- Quando houver informações na seção "📚 BASE DE CONHECIMENTO", elas têm PRIORIDADE ABSOLUTA sobre seu conhecimento geral.
- Siga EXATAMENTE as instruções da base de conhecimento, incluindo o que NÃO fazer.
- Se a base diz "NÃO peça X", você NÃO pede X — mesmo que pareça lógico.
- Se a base tem um roteiro de diagnóstico, siga-o na ORDEM indicada.

📱 FORMATO DE RESPOSTA — MÚLTIPLAS MENSAGENS:
- Responda como um HUMANO REAL faria no WhatsApp: envie 2-3 mensagens curtas em sequência, NÃO um textão.
- Separe cada mensagem com "---" em uma linha sozinha.
- Cada mensagem deve ter NO MÁXIMO 2-3 frases naturais e completas.
- Isso simula o comportamento humano de digitar e enviar várias mensagens rápidas.

✍️ NATURALIDADE E CLAREZA — REGRA CRÍTICA:
- Escreva frases COMPLETAS e NATURAIS. Nunca corte palavras para encurtar.
- Use frases que soem como uma pessoa real falaria em voz alta.
- NUNCA use abreviações: escreva "você" (não "vc"), "está" (não "tá"), "para" (não "pra"), "não é" (não "né"), "também" (não "tb").
- Prefira frases com estrutura gramatical completa e fluida.
- Exemplo CORRETO: "Você já tem cadastro com reconhecimento facial na loja ou é a primeira vez que está tentando acessar?"
- Exemplo ERRADO: "Vc já fez o cadastro facial na loja?"
- Exemplo CORRETO: "Em qual das nossas lojas você está?"
- Exemplo ERRADO: "Em qual loja vc tá?"

🔎 COLETA DE INFORMAÇÕES — REGRA DE OURO:
Antes de dizer "vou registrar" ou "vou encaminhar", CERTIFIQUE-SE de ter coletado:
1. ✅ QUAL UNIDADE/LOJA — SEMPRE confirme, mesmo que já tenhamos no perfil
2. ✅ O QUE ACONTECEU — descrição clara do problema
3. ✅ DETALHES ESPECÍFICOS — varia por tipo:
   - Produto: nome, código de barras, prateleira/seção
   - Pagamento: valor, o que tentou, erro exibido
   - Acesso: tipo de erro, primeira vez ou recorrente, se já tem cadastro
   - Limpeza/higiene: qual área, gravidade
   - Equipamento: qual aparelho, que erro mostra na tela

Se FALTAM informações, pergunte de forma natural e amigável antes de prosseguir.
NÃO registre/encaminhe com dados incompletos.

Exemplo BOM (cliente reportou falta de produto):
Eita, que chato isso 😕
---
Em qual loja você está? E qual produto que está faltando?

Exemplo BOM (cliente já disse a loja mas falta detalhe):
Entendi, lá no Alphavita 👍
---
Qual produto que você notou que está em falta? Se puder mandar uma foto da prateleira ajuda a gente localizar mais rápido 📸

Exemplo BOM (cliente perguntou preço):
Deixa eu ver aqui para você
---
Manda uma foto do código de barras que eu consulto rapidinho 📸

Exemplo BOM (problema de acesso/reconhecimento facial):
Poxa, que chato 😕 Você já tem cadastro com reconhecimento facial na loja?
---
Se já tem, a tela do equipamento na porta está mostrando algum erro? Pode mandar uma foto da tela para eu analisar 📸

Exemplo RUIM (textão único):
"Obrigada por nos avisar sobre a falta de produtos na loja Nilville. Vou encaminhar essa informação para a equipe responsável pelo abastecimento, para que eles possam resolver isso o mais rápido possível. A sua colaboração é fundamental para mantermos a loja completa."

- Seja conciso mas NUNCA sacrifique a naturalidade. Frases completas são mais importantes que brevidade extrema.
- PROIBIDO: parágrafos longos, explicações desnecessárias, frases motivacionais, agradecimentos elaborados.
- Se o cliente relatou um PROBLEMA: reconheça rapidamente, colete informações que faltam, e SÓ ENTÃO diga que vai resolver.

🚫 PROMESSAS VAZIAS — REGRA CRÍTICA:
- NUNCA diga "vou verificar", "vou consultar", "vou checar", "vou enviar a chave PIX" ou qualquer variação que crie expectativa de resposta futura.
- Você NÃO pode fazer ações sozinha. O sistema executa ações automaticamente APÓS sua resposta.
- Em vez de prometer: PEÇA o que precisa diretamente (ex: "Me envia uma foto do código de barras para eu consultar o valor 📸").
- Em vez de "vou enviar a chave PIX": apenas confirme o produto/valor — o sistema enviará a chave automaticamente via botões.
- Se NÃO tem informação suficiente: PEÇA ao cliente (código de barras, unidade, detalhes) em vez de prometer que vai buscar.`;

      // ── 8. PIX QUALIFICATION + AUTONOMOUS STORE SUPPORT INSTRUCTIONS ──
      const autonomousStoreHint = `\n\n🏪 CONTEXTO CRÍTICO — MINI MERCADO AUTÔNOMO 24H (SEM FUNCIONÁRIOS):
Este é um mini mercado que funciona 24 horas por dia, 7 dias por semana, SEM funcionários presentes. Você é o ÚNICO ponto de contato do cliente. O cliente DEPENDE 100% de você para resolver qualquer situação. Seja proativo, empático e resolutivo.

📋 GUIA DE ATENDIMENTO POR TIPO DE PROBLEMA:

🏷️ CONFIRMAÇÃO DE LOJA — PROTOCOLO OBRIGATÓRIO:
- SEMPRE confirme a unidade/loja com o cliente ANTES de registrar qualquer ocorrência
- Se o perfil já tem uma loja registrada, pergunte: "Você está na unidade [nome]?" — o cliente pode estar em OUTRA loja
- Se o cliente mencionar a loja no texto, confirme: "É na [nome], certo?"
- NUNCA registre ocorrência sem confirmação da loja pelo cliente
- Se o cliente NÃO informou a loja, pergunte de forma natural: "Em qual das nossas lojas você está?"

🔖 TAG DE CONFIRMAÇÃO DE LOJA — OBRIGATÓRIO:
Quando você quiser confirmar a unidade/loja com o cliente, INCLUA na sua resposta a tag:
[CONFIRMAR_LOJA:NomeDaLoja]
Exemplo: Se o cliente mencionou "w Ville", inclua [CONFIRMAR_LOJA:W Ville] na resposta.
Se o perfil tem "Alphavita", inclua [CONFIRMAR_LOJA:Alphavita] na resposta.
NÃO escreva a pergunta de confirmação de loja por extenso — use APENAS a tag. O sistema vai gerar botões interativos automaticamente.
Se você NÃO sabe o nome da loja, NÃO use a tag — pergunte normalmente "Em qual loja você está?".

📋 PROTOCOLO DE COLETA DE INFORMAÇÕES — ANTES DE REGISTRAR/ENCAMINHAR:
Para CADA tipo de problema, colete os dados listados ANTES de dizer que vai resolver:

🔴 ACESSO BLOQUEADO / RECONHECIMENTO FACIAL / PORTA NÃO ABRE:
- ✅ Qual unidade/loja? (confirmar)
- ✅ O cliente já possui cadastro facial? Se NÃO: orientar a escanear QR Code na porta.
- ✅ Se já tem cadastro: perguntar se a TELA DO EQUIPAMENTO NA PORTA mostra algum erro.
- 📸 Pedir foto da tela do equipamento para análise: "Pode tirar uma foto da tela do equipamento na porta? Assim consigo ver o erro certinho 📸"
- ⚠️ O reconhecimento facial é um EQUIPAMENTO FIXO na PORTA da loja, NÃO é a câmera do celular do cliente!
- ⚠️ NUNCA peça para "limpar a câmera do celular" ou "centralizar o rosto" — isso não faz sentido.
- Se problema persistente: registre ocorrência com detalhes do erro.

⚡ LOJA SEM ENERGIA / EQUIPAMENTOS DESLIGADOS:
- ✅ Qual unidade? (confirmar)
- ✅ Quais equipamentos estão sem funcionar? (geladeira, iluminação, totem)
- Registre IMEDIATAMENTE como prioridade ALTA

🖥️ TOTEM DE PAGAMENTO COM DEFEITO:
- ✅ Qual unidade? (confirmar)
- ✅ Qual o erro exibido? Tela travada? Não aceita cartão? Não lê código?
- Oriente: tentar reiniciar (botão lateral 30s)
- Se não resolver: peça foto do código de barras para PIX

💳 PROBLEMAS DE PAGAMENTO / COBRANÇA:
- ✅ Qual unidade? (confirmar)
- ✅ O que aconteceu? Cobrou diferente? Cobrou duas vezes? Cartão recusado?
- ✅ SEMPRE peça código de barras dos produtos
- Se cobrança indevida: peça comprovante

📦 FALTA DE PRODUTO / PRODUTO VENCIDO:
- ✅ Qual unidade? (confirmar)
- ✅ Qual produto? Em qual prateleira/seção?
- ✅ Se vencido: oriente NÃO consumir, registre prioridade ALTA

🧹 LOJA SUJA / PROBLEMAS DE HIGIENE:
- ✅ Qual unidade? (confirmar)
- ✅ Onde está sujo? Qual área?
- Registre para equipe de limpeza

🚨 FURTO / SITUAÇÃO SUSPEITA:
- ✅ Qual unidade? (confirmar)
- ✅ O que observou? Horário?
- NÃO peça ao cliente intervir
- Registre prioridade ALTA

💡 SUGESTÕES / ELOGIOS:
- Agradeça efusivamente
- Registre para a equipe

⚖️ TERMOS JURÍDICOS (processo, Procon, advogado):
- PARE e responda: "Entendo a gravidade. Vou encaminhar imediatamente para nossa equipe responsável."
- Registre prioridade ALTA

🔄 MÚLTIPLOS PROBLEMAS:
- Trate CADA problema individualmente
- Priorize: energia/segurança > pagamento > acesso > limpeza > sugestão
- Confirme que TODOS foram registrados`;

      const pixQualificationHint = `\n\n💳 REGRAS DE PIX/PAGAMENTO (OBRIGATÓRIO — SEGUIR À RISCA):
- NUNCA envie a chave PIX proativamente em texto. NUNCA inclua o email "financeiro@nutricarbrasil.com.br" na sua resposta. O sistema controla o envio automaticamente.
- O FLUXO OBRIGATÓRIO para qualquer situação envolvendo pagamento é:

  📋 ETAPA 1 — ENTENDER O PROBLEMA:
  - Demonstre empatia
  - Pergunte SOMENTE os detalhes que ainda NÃO foram informados (loja, o que aconteceu)
  - NÃO ofereça PIX nesta etapa

  📸 ETAPA 2 — IDENTIFICAR PRODUTOS E VALORES:
  - Peça ao cliente para enviar uma FOTO DO CÓDIGO DE BARRAS de TODOS os produtos que pegou
  - Explique: "Com o código de barras consigo consultar o valor exato no sistema"
  - Se o cliente enviar o nome do produto em vez do código, tente consultar, mas INCENTIVE o envio do código de barras para precisão
  - ⚡ ATALHO: Se o cliente JÁ SABE o valor (ex: "preciso pagar R$ 15", "o total é 12,50", "cartão não passou, eram R$ 20"), NÃO peça código de barras. Aceite o valor informado pelo cliente e prossiga direto para a confirmação.
  - DICA: Clientes cujo cartão foi recusado geralmente já viram o valor no totem — nesse caso NÃO é necessário pedir código de barras.

  🛒 ETAPA 3 — CONFIRMAR VALORES:
  - Após identificar os produtos/valores (via catálogo OU informados pelo cliente), confirme
  - O SISTEMA enviará automaticamente um botão interativo perguntando se o cliente deseja receber a chave PIX
  - NÃO tente enviar a chave PIX no texto — o sistema faz isso via botão

  ✅ ETAPA 4 — CHAVE PIX (AUTOMÁTICA):
  - A chave PIX SÓ é enviada quando o cliente clica no botão "Enviar chave PIX"
  - Você NÃO precisa (e NÃO deve) enviar a chave no texto

- NUNCA assuma que "problema com pagamento" = "quer pagar via PIX". O cliente pode querer estorno, reclamação, ou ajuda técnica.
- Se o cliente NÃO informou valor E NÃO enviou código de barras, peça um dos dois antes de oferecer PIX.
- Se o cliente disser "já paguei" ou "tá pago", NÃO envie chave PIX — peça o comprovante.`;

      // ── 9. KNOWLEDGE BASE: inject relevant articles ──
      let knowledgeContext = "";
      try {
        // Load always_inject categories + their active articles
        const { data: alwaysCats } = await supabase
          .from("knowledge_categories")
          .select("id, name")
          .eq("created_by", ctx.userId)
          .eq("always_inject", true);

        const alwaysCatIds = (alwaysCats || []).map((c: any) => c.id);

        // Load on-demand categories for keyword matching
        const { data: demandCats } = await supabase
          .from("knowledge_categories")
          .select("id, name")
          .eq("created_by", ctx.userId)
          .eq("always_inject", false);

        // Determine which on-demand categories match the client's message
        const clientText = (groupedMessages || transcription || ctx.messageContent || "").toLowerCase();
        const matchedDemandIds: string[] = [];

        if (clientText.length > 2 && demandCats?.length) {
          // Load articles from demand categories to check tags
          const demandIds = demandCats.map((c: any) => c.id);
          const { data: demandArts } = await supabase
            .from("knowledge_articles")
            .select("id, category_id, title, tags")
            .eq("is_active", true)
            .in("category_id", demandIds);

          for (const art of demandArts || []) {
            const titleMatch = clientText.includes(art.title.toLowerCase());
            const tagMatch = (art.tags || []).some((tag: string) => clientText.includes(tag.toLowerCase()));
            if (titleMatch || tagMatch) {
              if (!matchedDemandIds.includes(art.category_id)) {
                matchedDemandIds.push(art.category_id);
              }
            }
          }
        }

        const allRelevantCatIds = [...alwaysCatIds, ...matchedDemandIds];

        if (allRelevantCatIds.length > 0) {
          const { data: kbArticles } = await supabase
            .from("knowledge_articles")
            .select("id, title, content, category_id")
            .eq("is_active", true)
            .in("category_id", allRelevantCatIds);

          if (kbArticles?.length) {
            const allCats = [...(alwaysCats || []), ...(demandCats || [])];
            const catMap = Object.fromEntries(allCats.map((c: any) => [c.id, c.name]));

            knowledgeContext = "\n\n📚 BASE DE CONHECIMENTO DA EMPRESA (use estas informações para responder com precisão):";
            const grouped: Record<string, string[]> = {};
            const usedArticleIds: string[] = [];
            for (const art of kbArticles) {
              const catName = catMap[art.category_id] || "Geral";
              if (!grouped[catName]) grouped[catName] = [];
              grouped[catName].push(`• ${art.title}: ${art.content}`);
              usedArticleIds.push(art.id);
            }
            for (const [cat, items] of Object.entries(grouped)) {
              knowledgeContext += `\n\n[${cat}]\n${items.join("\n")}`;
            }
            console.log(`[KB] Injected ${kbArticles.length} articles from ${allRelevantCatIds.length} categories`);

            // Increment hit_count for used articles
            if (usedArticleIds.length > 0) {
              for (const artId of usedArticleIds) {
                await supabase.rpc("increment_kb_hit_count", { _article_id: artId });
              }
            }
          }
        }
      } catch (kbErr) {
        console.error("[KB] Error loading knowledge base:", kbErr);
      }

      let imageHint = "";
      if (ctx.messageType === "image" || (ctx as any)._lastImageUrl) {
        imageHint = `\n\n📸 IMAGEM RECEBIDA DO CLIENTE — INSTRUÇÕES ESPECIAIS:
O cliente enviou uma IMAGEM. Sua prioridade é:
1. Se a imagem contém um CÓDIGO DE BARRAS ou PRODUTO: diga "Já estou consultando esse produto no catálogo! 🔍" — O sistema fará a busca automaticamente e enviará o resultado logo em seguida.
2. NÃO peça nome completo ou unidade quando o cliente envia uma foto de código de barras — isso significa que ele quer saber o preço ou pagar.
3. Se a imagem é um COMPROVANTE DE PAGAMENTO: diga "Recebi seu comprovante, estou analisando! ✅" — o sistema verificará automaticamente.
4. Se a imagem não é legível: peça para reenviar com mais foco/iluminação.
5. NUNCA ignore a imagem ou responda como se fosse apenas texto.
6. NUNCA diga "vou verificar" ou "vou enviar a chave" sem contexto — o sistema cuida dessas ações automaticamente.`;
      }

      // ── TTS DICTION: force formal spelling when reply will be audio ──
      let ttsDictionHint = "";
      const willBeAudio = Object.prototype.hasOwnProperty.call(ctx.variables, "transcricao") ||
        ((ctx.messageType === "audio" || ctx.messageType === "ptt") && aiAudioReplyEnabled);
      if (willBeAudio) {
        ttsDictionHint = `

⚠️ REGRA OBRIGATÓRIA — DICÇÃO PARA ÁUDIO (TTS):
Esta resposta será CONVERTIDA EM ÁUDIO. Você DEVE escrever com ortografia COMPLETA e FORMAL.
- NUNCA use abreviações: "vc" → "você", "tá" → "está", "tô" → "estou", "pra" → "para", "né" → "não é", "tb" → "também", "qdo" → "quando", "q" → "que", "td" → "tudo", "blz" → "beleza", "msg" → "mensagem", "info" → "informação", "dps" → "depois", "hj" → "hoje", "obg" → "obrigado", "vlw" → "valeu", "pfv" → "por favor", "tbm" → "também", "cmg" → "comigo", "ctz" → "certeza", "mt" → "muito", "msm" → "mesmo", "vdd" → "verdade", "bom d+" → "muito bom", "d+" → "demais"
- Escreva TODAS as palavras por EXTENSO sem exceção.
- Use pontuação correta para ritmo natural de fala.
- Valores monetários por extenso: "cento e cinquenta reais" em vez de "R$ 150,00".
- Números por extenso: "três dias" em vez de "3 dias".
- Mantenha o tom amigável e natural, mas com palavras COMPLETAS.
- Exemplo CORRETO: "Você está bem? Vou verificar isso para você!"
- Exemplo ERRADO: "vc tá bem? vou verificar pra vc!"`;
      }

      // ── Compose final enriched system prompt ──
      const enrichedSystemPrompt = systemPrompt + profileContext + memoryHint + productContext + knowledgeContext + sentimentHint + toneHint + fewShotHint + languageHint + variationHint + autonomousStoreHint + pixQualificationHint + imageHint + ttsDictionHint;

      // Merge and sort by created_at
      const allRecent = [
        ...(recentInbound || []),
        ...(recentOutbound || []),
      ].sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      // Track grouped content to avoid duplicating
      const groupedContentSet = new Set<string>();
      if (groupedMessages) {
        for (const line of groupedMessages.split("\n")) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("[")) groupedContentSet.add(trimmed);
        }
      }

      const messages = allRecent.map((m: any, idx: number, arr: any[]) => {
        let content = m.content || "";
        const isLastInbound = m.direction === "inbound" && idx === arr.length - 1;

        // Skip inbound messages already present in grouped messages
        if (m.direction === "inbound" && content && groupedContentSet.has(content.trim())) {
          return null;
        }

        if (!content && (m.type === "audio" || m.type === "ptt")) {
          if (isLastInbound && transcription) {
            content = `[Áudio do cliente - transcrição]: ${transcription}`;
          } else {
            content = "[Áudio sem transcrição disponível]";
          }
        } else if (m.type === "image" && m.media_url) {
          const imgDesc = ctx.variables["descricao_imagem"] || "";
          if (isLastInbound && imgDesc) {
            content = `[Imagem do cliente - descrição]: ${imgDesc}`;
          } else {
            content = "[Imagem enviada pelo cliente]";
          }
          // Only use image for vision analysis if it's RECENT (within last 2 minutes)
          // This prevents old images from being analyzed when the current message is just text
          if (m.direction === "inbound") {
            const msgAge = Date.now() - new Date(m.created_at).getTime();
            const twoMinutesMs = 2 * 60 * 1000;
            if (msgAge < twoMinutesMs) {
              (ctx as any)._lastImageUrl = m.media_url;
            }
          }
        } else if (!content && m.type === "document") {
          if (isLastInbound && pdfContent) {
            content = `[Documento do cliente - conteúdo extraído]: ${pdfContent.slice(0, 1500)}`;
          } else {
            content = "[Documento enviado pelo cliente]";
          }
        } else if (!content) {
          content = `[${m.type || "mídia"}]`;
        }

        return { direction: m.direction, content };
      }).filter(Boolean);

      // Add grouped messages as a single consolidated entry (if not already covered)
      if (groupedMessages) {
        messages.push({
          direction: "inbound",
          content: `[Mensagens recentes do cliente]:\n${groupedMessages}`,
        });
      }

      // If transcription exists but wasn't matched to last msg (e.g., collect+transcribe flow)
      if (transcription && !messages.some((m: any) => m.content.includes(transcription))) {
        messages.push({
          direction: "inbound",
          content: `[Transcrição do áudio do cliente]: ${transcription}`,
        });
      }

      // ── Multimodal: if last message is image, include as vision content ──
      let imageBase64: string | null = null;
      const lastImageUrl = (ctx as any)._lastImageUrl;
      if (lastImageUrl) {
        try {
          const imgResp = await fetch(lastImageUrl);
          if (imgResp.ok) {
            const imgBuffer = await imgResp.arrayBuffer();
            const { encode: base64Encode } = await import("https://deno.land/std@0.168.0/encoding/base64.ts");
            imageBase64 = base64Encode(imgBuffer);
            console.log(`Image downloaded for vision analysis (${Math.round(imgBuffer.byteLength / 1024)}KB)`);
          }
        } catch (e) {
          console.error("Failed to download image for vision:", e);
        }
      }

      // Build chat messages with enriched system prompt
      const chatMessages: any[] = [
        { role: "system", content: enrichedSystemPrompt },
      ];

      // ── PROGRESSIVE PROFILE: save name/store/condomínio if detected in conversation ──
      // (runs async, doesn't block response)
      try {
        const allText = (groupedMessages || transcription || ctx.messageContent || "");
        const allTextLower = allText.toLowerCase();
        // Auto-save name if not yet known
        if ((!contactProfile?.name || contactProfile.name === ctx.contactPhone) && allText.length > 5) {
          const nameMatch = allText.match(/(?:meu nome é|me chamo|sou o |sou a |aqui é o |aqui é a )\s*([A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇ][a-záàâãéèêíïóôõöúç]+(?:\s+[A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇ][a-záàâãéèêíïóôõöúç]+){0,3})/i);
          if (nameMatch?.[1]) {
            const detectedName = nameMatch[1].trim();
            console.log(`[PROFILE] Auto-detected name: "${detectedName}"`);
            await supabase.from("contacts").update({ name: detectedName }).eq("id", ctx.contactId);
            ctx.contactName = detectedName;
          }
        }
        // Auto-save condomínio/unidade in custom_fields if detected and not yet stored
        const existingCustom = (contactProfile?.custom_fields as Record<string, any>) || {};
        if (!existingCustom.condominio && allTextLower.length > 5) {
          const condoMatch = allText.match(/(?:condom[ií]nio|unidade|loja|resid[eê]ncia[l]?)\s+([A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇ][a-záàâãéèêíïóôõöúç]+(?:\s+[A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇ0-9][a-záàâãéèêíïóôõöúç0-9]*){0,3})/i);
          if (condoMatch?.[1]) {
            const detectedCondo = condoMatch[1].trim();
            console.log(`[PROFILE] Auto-detected condomínio: "${detectedCondo}"`);
            const updatedCustom = { ...existingCustom, condominio: detectedCondo };
            await supabase.from("contacts").update({ custom_fields: updatedCustom }).eq("id", ctx.contactId);
            if (contactProfile) (contactProfile as any).custom_fields = updatedCustom;
          }
        }
      } catch (e) {
        console.error("[PROFILE] Auto-save error:", e);
      }

      for (const m of messages) {
        const role = m.direction === "inbound" ? "user" : "assistant";
        chatMessages.push({ role, content: m.content });
      }

      // If we have an image, add it as multimodal content to the last user message
      if (imageBase64) {
        // Find last user message and make it multimodal
        for (let i = chatMessages.length - 1; i >= 0; i--) {
          if (chatMessages[i].role === "user") {
            const textContent = chatMessages[i].content || "Analise esta imagem enviada pelo cliente.";
            chatMessages[i].content = [
              { type: "text", text: textContent },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
            ];
            break;
          }
        }
      }

      let reply = "";

      // Try user's own API key first
      // OpenAI gpt-4o supports vision natively (images, PDFs), prefer it when available
      // This avoids needing Lovable AI fallback for multimodal content
      const selectedProvider = disabledProviders.has("openai")
        ? "gemini"
        : (keys.openai ? "openai" : (keys.gemini ? "gemini" : "openai"));
      const hasUserKey = !!keys[selectedProvider];

      if (hasUserKey) {
        try {
          if (selectedProvider === "openai") {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), aiTimeoutSeconds * 1000);
            // Force gpt-4o for multimodal (images/vision) - it has the best vision support
            const openaiModel = imageBase64 ? "gpt-4o" : mapModelForProvider(model, "openai");
            const isReasoning = imageBase64 ? false : isReasoningModel(openaiModel);
            
            // o1/o3 models: use "developer" instead of "system", max_completion_tokens instead of max_tokens, no temperature
            const openaiMessages = isReasoning
              ? chatMessages.map((m: any) => ({ ...m, role: m.role === "system" ? "developer" : m.role }))
              : chatMessages;
            
            const openaiBody: any = { model: openaiModel, messages: openaiMessages };
            if (isReasoning) {
              openaiBody.max_completion_tokens = maxTokens;
            } else {
              openaiBody.max_tokens = maxTokens;
              openaiBody.temperature = 0.7;
            }
            
            const resp = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: { Authorization: `Bearer ${keys.openai}`, "Content-Type": "application/json" },
              body: JSON.stringify(openaiBody),
              signal: controller.signal,
            });
            clearTimeout(tid);
            if (resp.ok) {
              const data = await resp.json();
              reply = data.choices?.[0]?.message?.content?.trim() || "";
            } else {
              const errText = await resp.text();
              console.error(`OpenAI user key failed (${resp.status}): ${errText.slice(0, 100)}`);
              if (resp.status === 429 || resp.status === 401 || resp.status === 403) {
                disabledProviders.add("openai");
                console.log(`[AI] OpenAI disabled for remaining calls (${resp.status}), will use Gemini`);
              }
            }
          } else {
            const geminiContents = chatMessages.filter((m: any) => m.role !== "system").map((m: any) => {
              const parts: any[] = [];
              if (Array.isArray(m.content)) {
                // Multimodal content (text + image)
                for (const part of m.content) {
                  if (part.type === "text") {
                    parts.push({ text: part.text });
                  } else if (part.type === "image_url" && part.image_url?.url?.startsWith("data:")) {
                    const match = part.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
                    if (match) {
                      parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
                    }
                  }
                }
              } else {
                parts.push({ text: String(m.content || "") });
              }
              return { role: m.role === "assistant" ? "model" : "user", parts };
            });
            const controller2 = new AbortController();
            const tid2 = setTimeout(() => controller2.abort(), aiTimeoutSeconds * 1000);
            const resp = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${mapModelForProvider(model, "gemini")}:generateContent?key=${keys.gemini}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  system_instruction: { parts: [{ text: enrichedSystemPrompt }] },
                  contents: geminiContents,
                  generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
                }),
                signal: controller2.signal,
              }
            );
            clearTimeout(tid2);
            if (resp.ok) {
              const data = await resp.json();
              reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
            } else {
              const errText = await resp.text();
              console.error(`Gemini user key failed (${resp.status}): ${errText.slice(0, 100)}`);
              if (resp.status === 429 || resp.status === 401 || resp.status === 403) {
                disabledProviders.add("gemini");
              }
            }
          }
        } catch (userKeyErr) {
          console.error(`User key error:`, userKeyErr);
        }
      }

      // Fallback: retry with OTHER provider if first one failed
      if (!reply) {
        const { keys: fallbackKeys, aiTimeout: fallbackTimeout } = await getUserAIKeys(supabase, ctx.userId);
        // Filter out disabled providers from fallback keys
        const effectiveKeys: Record<string, string> = {};
        if (fallbackKeys.openai && !disabledProviders.has("openai")) effectiveKeys.openai = fallbackKeys.openai;
        if (fallbackKeys.gemini && !disabledProviders.has("gemini")) effectiveKeys.gemini = fallbackKeys.gemini;
        // If both disabled, re-enable gemini as last resort
        if (!effectiveKeys.openai && !effectiveKeys.gemini && fallbackKeys.gemini) effectiveKeys.gemini = fallbackKeys.gemini;
        
        if (effectiveKeys.openai || effectiveKeys.gemini) {
          console.log(`Using fallback AI keys (providers: ${Object.keys(effectiveKeys).join(", ")})`);
          if (imageBase64) {
            const systemContent = chatMessages.find((m: any) => m.role === "system")?.content || "";
            const userContent = chatMessages.filter((m: any) => m.role !== "system").map((m: any) => typeof m.content === "string" ? m.content : "").join("\n");
            reply = await callAIVisionWithUserKeys(effectiveKeys, systemContent + "\n" + userContent, imageBase64, { maxTokens, timeoutMs: fallbackTimeout * 1000 });
          } else {
            const fullPrompt = chatMessages.map((m: any) => `[${m.role}]: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`).join("\n");
            reply = await callAIWithUserKeys(effectiveKeys, fullPrompt, { maxTokens, temperature: 0.7, timeoutMs: fallbackTimeout * 1000 });
          }
        }
        // Lovable AI Gateway fallback (superior model)
        if (!reply) {
          const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
          if (LOVABLE_API_KEY) {
            const gatewayModel = "google/gemini-2.5-flash";

            // Build messages for the gateway: if we have an image, include it as multimodal content
            let gatewayMessages = chatMessages;
            if (imageBase64) {
              const mimeType = imageBase64.startsWith("/9j/") ? "image/jpeg" : imageBase64.startsWith("iVBOR") ? "image/png" : "image/jpeg";
              const systemMsg = chatMessages.find((m: any) => m.role === "system");
              const nonSystemMsgs = chatMessages.filter((m: any) => m.role !== "system");
              const userTextParts = nonSystemMsgs.map((m: any) => typeof m.content === "string" ? m.content : "").filter(Boolean).join("\n");
              gatewayMessages = [
                ...(systemMsg ? [systemMsg] : []),
                {
                  role: "user",
                  content: [
                    { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
                    { type: "text", text: userTextParts || "Analise esta imagem." },
                  ],
                },
              ];
            }

            console.log(`[AI] Trying Lovable AI Gateway with ${gatewayModel}${imageBase64 ? " (with image)" : ""}`);
            try {
              const controller = new AbortController();
              const tid = setTimeout(() => controller.abort(), 30000);
              const gatewayResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${LOVABLE_API_KEY}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  model: gatewayModel,
                  messages: gatewayMessages,
                  max_tokens: maxTokens,
                  temperature: 0.7,
                }),
                signal: controller.signal,
              });
              clearTimeout(tid);
              if (gatewayResp.ok) {
                const data = await gatewayResp.json();
                reply = data.choices?.[0]?.message?.content?.trim() || "";
                if (reply) console.log(`[AI] Lovable Gateway success (${reply.length} chars)`);
              } else {
                const errText = await gatewayResp.text();
                console.error(`[AI] Lovable Gateway error (${gatewayResp.status}): ${errText.slice(0, 150)}`);
                // If image caused the error, retry text-only
                if (imageBase64 && (gatewayResp.status === 400 || gatewayResp.status === 422)) {
                  console.log("[AI] Retrying Lovable Gateway without image (text-only fallback)");
                  const textOnlyMsgs = chatMessages.map((m: any) => ({
                    role: m.role,
                    content: typeof m.content === "string" ? m.content : Array.isArray(m.content)
                      ? m.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n")
                      : JSON.stringify(m.content),
                  }));
                  textOnlyMsgs.push({ role: "user", content: "[O cliente enviou uma imagem que não pôde ser processada. Responda com base no contexto da conversa.]" });
                  const ctrl2 = new AbortController();
                  const tid2 = setTimeout(() => ctrl2.abort(), 25000);
                  const retryResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
                    method: "POST",
                    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ model: gatewayModel, messages: textOnlyMsgs, max_tokens: maxTokens, temperature: 0.7 }),
                    signal: ctrl2.signal,
                  });
                  clearTimeout(tid2);
                  if (retryResp.ok) {
                    const data = await retryResp.json();
                    reply = data.choices?.[0]?.message?.content?.trim() || "";
                    if (reply) console.log(`[AI] Lovable Gateway text-only fallback success (${reply.length} chars)`);
                  }
                }
              }
            } catch (e) {
              console.error("[AI] Lovable Gateway call failed:", e);
            }
          }
        }
        if (!reply) {
          throw new Error("Nenhuma API key configurada (OpenAI/Gemini) ou todas as tentativas falharam");
        }
      }

      if (reply) {
        console.log(`[LLM] Reply generated (${reply.length} chars, maxTokens=${maxTokens}): "${reply.slice(0, 120)}..."`);
        const hasCatalogProduct =
          ctx.variables["produto_encontrado"] === "true" &&
          !!ctx.variables["produto_nome"] &&
          !!ctx.variables["produto_preco"];

        const catalogProductName = String(ctx.variables["produto_nome"] || "").trim();
        const catalogPriceValue = Number(ctx.variables["produto_preco"] || 0);
        const catalogPriceFormatted = Number.isFinite(catalogPriceValue)
          ? catalogPriceValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
          : "";

        const extractReplyPrices = (text: string): number[] => {
          const matches = text.match(/R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}|R\$\s*\d+(?:[.,]\d{2})/gi) || [];
          return matches
            .map((raw) => Number(raw.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")))
            .filter((n) => Number.isFinite(n));
        };

        const pricesInReply = extractReplyPrices(reply);
        const isPriceTopic = /\b(valor|preço|preco|pix|pagamento|pagar)\b/i.test(reply);

        // Hard guard: never allow price in LLM reply without catalog-confirmed product
        if (pricesInReply.length > 0 && !hasCatalogProduct) {
          console.warn(`[LLM GUARD] Blocking unverified price in reply: "${reply.slice(0, 120)}"`);
          const blockedReply = reply;
          reply = "Para te passar o valor exato, preciso identificar o produto no catálogo. Pode me enviar o nome do produto ou uma foto nítida do código de barras?";
          ctx.variables["_audit_guard_block"] = `Preço não verificado bloqueado. Original: "${blockedReply.slice(0, 200)}"`;
          console.log(`[AUDIT] Guard blocked unverified price at ${new Date().toISOString()}`);
        } else if (hasCatalogProduct && pricesInReply.length > 0) {
          const hasCatalogPriceInReply = pricesInReply.some((p) => Math.abs(p - catalogPriceValue) < 0.01);
          if (!hasCatalogPriceInReply) {
            console.warn(`[LLM GUARD] Correcting mismatched price. catalog=${catalogPriceValue}, reply="${reply.slice(0, 120)}"`);
            reply = `Perfeito! Encontrei no catálogo:\n\n🛒 Produto: *${catalogProductName}*\n💰 Valor: *${catalogPriceFormatted}*`;
          }
        }

        // If talking about price/payment, enforce explicit product name + exact catalog price
        if (hasCatalogProduct && isPriceTopic) {
          const normalizedReply = reply.toLowerCase();
          const hasName = catalogProductName ? normalizedReply.includes(catalogProductName.toLowerCase()) : false;
          const hasPrice = catalogPriceFormatted ? normalizedReply.includes(catalogPriceFormatted.toLowerCase()) : false;
          if (!hasName || !hasPrice) {
            reply = `🛒 Produto: *${catalogProductName}*\n💰 Valor: *${catalogPriceFormatted}*\n\n${reply}`;
          }
        }

        // Never promise QR Code (this flow sends PIX key text only)
        const mentionsQrCode = /\b(qr\s*code|qrcode)\b/i.test(reply);
        if (mentionsQrCode) {
          if (hasCatalogProduct) {
            reply = buildPixPaymentMessage(catalogProductName, catalogPriceValue);
            ctx.variables["_pix_key_sent"] = "true";
          } else {
            reply = reply.replace(/\b(qr\s*code|qrcode)\b/gi, "chave PIX");
          }
        }

        // ── SANITIZE: Strip PIX key from LLM reply (system sends it separately) ──
        const pixKeyPattern = /financeiro@nutricarbrasil\.com\.br/gi;
        if (pixKeyPattern.test(reply)) {
          reply = reply.replace(pixKeyPattern, "[chave PIX]");
          console.log(`[SANITIZE] Removed PIX key from LLM reply`);
          ctx.variables["_audit_guard_block"] = (ctx.variables["_audit_guard_block"] || "") + " | LLM incluiu chave PIX no texto — removida.";
        }

        // ── DOUBLE PROTECTION: enforce concise style + difficulty confirmation before PIX ──
        const customerContextForGuard = [
          ctx.messageContent,
          ctx.variables["mensagens_agrupadas"] || "",
          ctx.variables["transcricao"] || "",
        ].join(" ");

        const isPaymentOrCatalogContext = /\b(valor|preço|preco|pix|pagamento|pagar|barcode|c[oó]digo\s+de\s+barras?)\b/i.test(customerContextForGuard) || hasCatalogProduct;
        if (!isPaymentOrCatalogContext) {
          const guarded = enforceConciseNaturalReply(reply);
          if (guarded !== reply) {
            console.log(`[LLM STYLE GUARD] Reply normalized (${reply.length} -> ${guarded.length} chars)`);
          }
          reply = guarded;
        }

        const isDifficultyContext = PIX_DIFFICULTY_KEYWORDS.test(customerContextForGuard);
        if (isDifficultyContext) {
          ctx.variables["_difficulty_detected"] = "true";
          console.log(`[PIX GUARD] Difficulty detected in LLM reply context — setting _difficulty_detected flag`);
        }
        const replyOffersPix = /\b(enviar?\s*(a\s*)?chave|chave\s*pix|pagar?\s*(via|por|com)\s*pix|pagamento\s*(via|por|com)\s*pix)\b/i.test(reply);

        if (replyOffersPix && ctx.variables["_pix_key_sent"] !== "true") {
          // Strip PIX text offers — interactive buttons will handle this instead
          reply = reply.replace(
            /(?:se\s*(?:quiser|preferir|desejar),?\s*)?(?:j[aá]\s*)?(?:te\s*)?(?:posso\s*)?(?:enviar?|mand[ao]r?)\s*(?:a\s*)?chave\s*pix[^.!?\n]*/gi,
            ""
          );
          reply = reply.replace(
            /vou\s*(?:te\s*)?enviar?\s*(?:a\s*)?chave\s*pix[^.!?\n]*/gi,
            ""
          );
          reply = reply.replace(
            /gostaria\s*que\s*eu\s*envi[ae]\s*(?:a\s*)?chave\s*pix[^.!?\n]*/gi,
            ""
          );
          reply = reply.replace(
            /(?:deseja|quer)\s*(?:receber|que\s*eu\s*envi[ae])\s*(?:a\s*)?chave\s*pix[^.!?\n]*/gi,
            ""
          );
          // Clean up leftover whitespace/newlines
          reply = reply.replace(/\n{3,}/g, "\n\n").trim();
          console.log(`[PIX GUARD] Stripped PIX text offer from AI reply — interactive buttons will handle PIX offer`);
        }

        // ── AUTO-ESCALATE from LLM: detect if customer wants a human ──
        const HUMAN_ESCALATION_PATTERN = /\b(quero\s*falar\s*com\s*(uma?\s*)?(pessoa|humano|atendente|gerente|supervisor|responsável|algu[eé]m)|me\s*transfere|cadê\s*o\s*atendente|não\s*quero\s*(falar\s*com\s*)?(robô|bot|máquina|ia)|passa\s*pra\s*(algu[eé]m|uma?\s*pessoa|atendente)|atendente\s*por\s*favor|tem\s*algu[eé]m\s*a[ií]|falar\s*com\s*gente\s*de\s*verdade|atendimento\s*humano|preciso\s*de\s*(um\s*)?atendente|quero\s*um\s*humano)\b/i;
        const customerFullText = [ctx.messageContent, ctx.variables["mensagens_agrupadas"] || "", ctx.variables["transcricao"] || ""].join(" ");
        if (HUMAN_ESCALATION_PATTERN.test(customerFullText) && ctx.variables["_escalated_to_human"] !== "true") {
          console.log(`[ESCALATE-LLM] Human escalation pattern detected in customer message`);
          await autoEscalateToHuman(supabase, ctx);
          return { sent: true, model, reply: "[auto-escalated to human]", escalated: true };
        }

        // ── POST-REPLY: decide if we should resolve product from image before sending text ──
        const promisedToCheck = /verificar|vou checar|já te informo|vou consultar|deixa eu ver|momento.*valor/i.test(reply);
        const hasBarcodeMention = /código de barras|barcode|código.*barras|EAN|GTIN/i.test(reply) || /código de barras|barcode|EAN|GTIN/i.test(ctx.messageContent || "");
        const replyRequestsCatalogCheck = /preciso identificar o produto no cat[aá]logo/i.test(reply);
        const paymentContext = /\b(valor|preço|preco|pix|pagamento|pagar)\b/i.test(`${reply} ${ctx.messageContent} ${ctx.variables["mensagens_agrupadas"] || ""}`);
        // ALWAYS run barcode lookup when we have an image and product not yet found
        // This ensures barcode images are always processed, even without payment context
        const shouldRunPostReplyLookup =
          !!imageBase64 &&
          !!ctx.userId &&
          ctx.variables["produto_encontrado"] !== "true";
        // Hold primary reply when we have an image — try barcode lookup first
        const shouldHoldPrimaryReply = shouldRunPostReplyLookup && ctx.messageType === "image";

        // Store IA reply as variable for downstream nodes (e.g. TTS with {{ia_reply}})
        ctx.variables["ia_reply"] = reply;

        // If this run came through audio transcription route OR client sent audio and ai_audio_reply is enabled, prioritize audio reply
        const cameFromAudioRoute = Object.prototype.hasOwnProperty.call(ctx.variables, "transcricao");
        const clientSentAudio = (ctx.messageType === "audio" || ctx.messageType === "ptt") && aiAudioReplyEnabled;
        if (cameFromAudioRoute || clientSentAudio) {
          const voiceId = d.voice_id || "EXAVITQu4vr4xnSDxMaL";
          const audioResult = await sendElevenLabsAudioFromText(supabase, ctx, reply, voiceId);
          if (audioResult.sent) {
            await sendPixKeyIfPaymentRelated(supabase, ctx);
            return { sent: true, model, reply: (reply || "").slice(0, 80), suppressed: true, delivery: "audio" };
          }
          console.log(`Audio reply fallback to text: ${audioResult.reason || "unknown_reason"}`);
        }

        // ── AUTO STORE CONFIRMATION BUTTONS ──
        // Detect if the AI reply mentions/asks about a store and convert to interactive buttons
        let storeConfirmationHandled = false;
        if (!d.suppress_send && !shouldHoldPrimaryReply && ctx.variables["_store_confirmed"] !== "true") {
          // PRIMARY: Parse structured [CONFIRMAR_LOJA:Name] tag from AI reply
          let detectedStoreName = "";
          const tagMatch = reply.match(/\[CONFIRMAR_LOJA:([^\]]+)\]/i);
          const invalidStoreNames = new Set(["no","na","da","do","de","que","para","por","com","em","um","uma","os","as","ou","sim","não","nao","aqui","esse","essa","este","esta","isso","muito","mais","como","quando","onde","porque","meu","minha","outro","outra","loja","unidade","condominio","condomínio","problema","produto","acesso","acessar"]);
          if (tagMatch?.[1]) {
            const tagCandidate = tagMatch[1].trim();
            if (tagCandidate.length > 2 && !invalidStoreNames.has(tagCandidate.toLowerCase())) {
              detectedStoreName = tagCandidate;
              console.log(`[STORE CONFIRM] Detected via tag: "${detectedStoreName}"`);
            } else {
              console.log(`[STORE CONFIRM] Tag value "${tagCandidate}" rejected (stop word or too short)`);
            }
          }

          // FALLBACK: Regex patterns for when AI forgets the tag
          if (!detectedStoreName) {
            const fullReply = reply.replace(/\n*---\n*/g, " ");
            const storeConfirmPatterns = [
              /(?:vc|voc[eê])\s+(?:tá|está|ta|esta)\s+(?:na|no)\s+(?:unidade|loja|condom[ií]nio)\s+([A-ZÀ-Úa-zà-ú][\w\s\-']{2,25}?)\s*[?,!]/i,
              /(?:é|e)\s+(?:na|no|da|do)\s+(?:unidade|loja|condom[ií]nio)\s+([A-ZÀ-Ú][\w\s\-']{2,25}?)\s*,?\s*(?:certo|n[eé]|isso|correto|mesmo)\s*\??/i,
              /(?:unidade|loja|condom[ií]nio)\s+([A-ZÀ-Ú][\w\s\-']{2,25}?)\s*,?\s*(?:certo|n[eé]|isso|correto|mesmo)\s*\??/i,
            ];
            const stopWords = invalidStoreNames;
            for (const pat of storeConfirmPatterns) {
              const m = fullReply.match(pat);
              if (m?.[1]) {
                const candidate = m[1].trim().replace(/[.,;:!?\s]+$/g, "");
                if (candidate.length > 2 && !stopWords.has(candidate.toLowerCase())) {
                  detectedStoreName = candidate;
                  console.log(`[STORE CONFIRM] Detected via fallback regex: "${detectedStoreName}"`);
                  break;
                }
              }
            }
          }

          if (detectedStoreName && detectedStoreName.length > 1) {
            console.log(`[STORE CONFIRM] Detected store: "${detectedStoreName}" — sending interactive buttons`);

            // Remove the store confirmation tag and any confirmation question from reply
            let replyWithoutConfirmation = reply;
            // Always strip the structured tag
            replyWithoutConfirmation = replyWithoutConfirmation.replace(/\[CONFIRMAR_LOJA:[^\]]+\]\s*/gi, "").trim();
            const stripPatterns = [
              /(?:vc|voc[eê])\s+(?:tá|está|ta|esta)\s+(?:na|no)\s+(?:unidade|loja|condom[ií]nio)\s+[^\n?]+\??\s*/gi,
              /(?:é|e)\s+(?:na|no|da|do)\s+(?:unidade|loja|condom[ií]nio)?\s*[A-ZÀ-Ú][^\n,?]+,?\s*(?:certo|n[eé]|isso|correto|mesmo)\s*\??\s*/gi,
              /(?:unidade|loja|condom[ií]nio)\s+[A-ZÀ-Ú][^\n,?]+,?\s*(?:certo|n[eé]|isso|correto|mesmo)\s*\??\s*/gi,
              /em\s+qual\s+(?:unidade|loja|das\s+nossas\s+lojas)[^\n?]*\??\s*/gi,
            ];
            for (const pat of stripPatterns) {
              replyWithoutConfirmation = replyWithoutConfirmation.replace(pat, "").trim();
            }
            replyWithoutConfirmation = replyWithoutConfirmation.replace(/\n*---\n*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

            // Send non-confirmation text first
            if (replyWithoutConfirmation && replyWithoutConfirmation.length > 3) {
              const textParts = replyWithoutConfirmation.includes("---")
                ? replyWithoutConfirmation.split(/\n*---\n*/).map((s: string) => s.trim()).filter(Boolean)
                : [replyWithoutConfirmation];
              for (let i = 0; i < textParts.length; i++) {
                const part = textParts[i];
                const typingDelayMs = Math.min(Math.max(part.length * 30, 800), 3000);
                if (i > 0) await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1500));
                else await new Promise((r) => setTimeout(r, typingDelayMs));
                await sendWhatsAppMessage(supabase, ctx, part);
              }
              await new Promise((r) => setTimeout(r, 800 + Math.random() * 700));
            }

            // Send interactive buttons for store confirmation
            const confirmBody = `📍 Você está na unidade *${detectedStoreName}*?`;
            const btnLabel = detectedStoreName.length > 15 ? `✅ Sim` : `✅ Sim, ${detectedStoreName}`;
            const buttonsSent = await sendInteractiveButtons(
              supabase, ctx, confirmBody,
              [
                { label: btnLabel, id: `store_yes_${detectedStoreName.toLowerCase().replace(/\s+/g, "_").slice(0, 15)}` },
                { label: "❌ Não, outra", id: "store_change" },
              ],
              "Nutricar Brasil"
            );

            if (buttonsSent) {
              ctx.variables["_store_pending_confirmation"] = detectedStoreName;
              storeConfirmationHandled = true;
              console.log(`[STORE CONFIRM] Interactive buttons sent for "${detectedStoreName}"`);
            }
          }
        }

        // ── SMART MULTI-MESSAGE SEND: split on --- and send sequentially like a human ──
        if (!d.suppress_send && !shouldHoldPrimaryReply && !storeConfirmationHandled) {
          const messageParts = reply.includes("---")
            ? reply.split(/\n*---\n*/).map((s: string) => s.trim()).filter(Boolean)
            : [reply];

          for (let i = 0; i < messageParts.length; i++) {
            const part = messageParts[i];
            const typingDelayMs = Math.min(Math.max(part.length * 30, 800), 3000);
            if (i > 0) {
              await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1500));
            } else {
              await new Promise((r) => setTimeout(r, typingDelayMs));
            }
            await sendWhatsAppMessage(supabase, ctx, part);
          }
        } else if (!d.suppress_send && shouldHoldPrimaryReply) {
          ctx.variables["_audit_reply_suppressed"] = `Resposta suprimida para aguardar lookup de imagem: "${reply.slice(0, 200)}"`;
          console.log(`[AUDIT] Primary reply suppressed at ${new Date().toISOString()} — waiting for barcode lookup`);
        }

        if (shouldRunPostReplyLookup) {
          console.log("[POST-LLM] Triggered image product lookup after reply");
          try {
            // Quick AI call to extract barcode number AND/OR product name from the image
            const extractPrompt = `Você é um LEITOR DE CÓDIGO DE BARRAS e CONTADOR DE PRODUTOS ultra-preciso para produtos de supermercado/mini mercado.

TAREFA: Leia o código de barras na imagem E conte QUANTOS ITENS do mesmo produto aparecem.

INSTRUÇÕES CRÍTICAS PARA LEITURA:
1. Localize as BARRAS VERTICAIS e os NÚMEROS IMPRESSOS abaixo/ao lado delas
2. Leia CADA DÍGITO individualmente, da ESQUERDA para a DIREITA
3. EAN-13 = EXATAMENTE 13 dígitos (ex: 7891234567890) — é o mais comum no Brasil
4. EAN-8 = EXATAMENTE 8 dígitos
5. Códigos brasileiros geralmente começam com 789
6. Se houver números impressos abaixo das barras, use-os como FONTE PRINCIPAL
7. NUNCA invente dígitos — se não conseguir ler um número, coloque "?" no lugar

FORMATO DE RESPOSTA (OBRIGATÓRIO — sem explicações):
- Se encontrou código: CODIGO|NOME_PRODUTO (ex: 7891234567890|Coca-Cola 350ml)
- Se encontrou produto sem código: NOME_PRODUTO (ex: Coca-Cola 350ml)
- Se não conseguiu identificar NADA: NENHUM
- NÃO inclua quantidade — apenas identifique o produto`;
            
            const { keys: barcodeKeys } = await getUserAIKeys(supabase, ctx.userId);
            if (barcodeKeys.openai || barcodeKeys.gemini) {
              const extracted = (await callAIVisionWithUserKeys(barcodeKeys, extractPrompt, imageBase64, { maxTokens: 200, temperature: 0.1 })).replace(/\s+/g, " ").trim();
                console.log(`[POST-LLM] Barcode extraction result: "${extracted}"`);

                if (extracted && extracted !== "NENHUM" && extracted.length > 3) {
                  // Parse: BARCODE|NAME or NAME or BARCODE
                  const parts = extracted.split("|").map((p: string) => p.trim());
                  let barcodeNum = "";
                  let productHint = "";

                  if (parts.length >= 2) {
                    const rawBarcode = parts[0].replace(/[\s\-\.?]/g, "");
                    if (/^\d{6,13}$/.test(rawBarcode)) {
                      barcodeNum = rawBarcode;
                      productHint = parts[1];
                    } else {
                      barcodeNum = rawBarcode.replace(/\D/g, "");
                      productHint = parts[1] || parts[0];
                    }
                  } else {
                    const rawBarcode = parts[0].replace(/[\s\-\.?]/g, "");
                    barcodeNum = /^\d{6,13}$/.test(rawBarcode) ? rawBarcode : rawBarcode.replace(/\D/g, "");
                    if (!barcodeNum) productHint = parts[0];
                  }

                  console.log(`[POST-LLM] Parsed: barcode="${barcodeNum}", name="${productHint}"`);

                  let products: any[] | null = null;

                  // Strategy 1: Exact barcode via RPC
                  if (barcodeNum && barcodeNum.length >= 6) {
                    const { data: rpcResults } = await supabase.rpc("search_products", {
                      _user_id: ctx.userId,
                      _query: barcodeNum,
                      _limit: 3,
                    });
                    if (rpcResults?.length > 0) {
                      products = rpcResults;
                      console.log(`[POST-LLM] ✅ Barcode RPC match: ${rpcResults[0].name}`);
                    }
                  }

                  // Strategy 2: Partial barcode via LIKE (AI often misses last digits)
                  if (!products?.length && barcodeNum && barcodeNum.length >= 6) {
                    // Try progressively shorter prefixes
                    for (const prefixLen of [barcodeNum.length, barcodeNum.length - 1, barcodeNum.length - 2]) {
                      if (prefixLen < 6) break;
                      const prefix = barcodeNum.slice(0, prefixLen);
                      const { data: likeResults } = await supabase
                        .from("products")
                        .select("id, name, barcode, price, category")
                        .eq("user_id", ctx.userId)
                        .eq("is_active", true)
                        .like("barcode", `${prefix}%`)
                        .limit(3);
                      if (likeResults?.length > 0) {
                        products = likeResults;
                        console.log(`[POST-LLM] ✅ Barcode LIKE match (${prefix}%): ${likeResults[0].name}`);
                        break;
                      }
                    }
                  }

                  // Strategy 3: Product name search
                  if (!products?.length && productHint && productHint.length > 2) {
                    const { data: nameResults } = await supabase.rpc("search_products", {
                      _user_id: ctx.userId,
                      _query: productHint,
                      _limit: 3,
                    });
                    if (nameResults?.length > 0) {
                      products = nameResults;
                      console.log(`[POST-LLM] ✅ Name match: ${nameResults[0].name}`);
                    }
                  }

                  const searchQuery = barcodeNum || productHint;

                  if (products && products.length > 0) {
                      const first = products[0];
                      const unitPrice = Number(first.price || 0);
                      const unitPriceStr = unitPrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

                      ctx.variables["produto_encontrado"] = "true";
                      ctx.variables["produto_nome"] = first.name || "";
                      ctx.variables["produto_preco"] = String(unitPrice);

                      // ── BATCH MODE: If already in cart session, auto-add with qty=1 ──
                      let inCartSession = ctx.variables["_awaiting_more_products"] === "true";
                      if (!inCartSession) {
                        // Check if there are recent cart items (✅ Adicionado!) — means active cart
                        try {
                          let cartCheckQ = supabase
                            .from("messages")
                            .select("content")
                            .eq("contact_id", ctx.contactId)
                            .eq("direction", "outbound")
                            .order("created_at", { ascending: false })
                            .limit(10);
                          if (ctx.sessionStartedAt) cartCheckQ = cartCheckQ.gte("created_at", ctx.sessionStartedAt);
                          const { data: cartCheckMsgs } = await cartCheckQ;
                          inCartSession = (cartCheckMsgs || []).some((m: any) =>
                            /✅ Adicionado!/.test(m.content || "") || /pegou mais algum produto/i.test(m.content || "")
                          );
                        } catch {}
                      }

                      if (inCartSession) {
                        // Auto-add with qty=1, show updated cart
                        const itemTotalStr = unitPriceStr;
                        const confirmMsg = `✅ Adicionado!\n\n🛒 *${first.name}*\n💰 Unitário: *${unitPriceStr}*\n📦 Quantidade: *1*\n🧾 Subtotal: *${unitPriceStr}*\n\n📸 Envie mais fotos ou finalize!`;
                        await sendWhatsAppMessage(supabase, ctx, confirmMsg);

                        ctx.variables["produto_quantidade"] = "1";
                        ctx.variables["produto_total"] = String(unitPrice);
                        ctx.variables["_awaiting_quantity"] = "false";
                        ctx.variables["_awaiting_more_products"] = "true";

                        // Show cart summary with buttons
                        const cart = await recoverCartFromMessages(supabase, ctx);
                        let grandTotal = 0;
                        let cartSummary = "🛒 *Carrinho atual:*\n\n";
                        for (const item of cart) {
                          const iTotal = item.price * item.qty;
                          grandTotal += iTotal;
                          const uStr = item.price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
                          const tStr = iTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
                          cartSummary += `• *${item.name}* — ${uStr} x ${item.qty} = *${tStr}*\n`;
                        }
                        const grandTotalStr = grandTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
                        cartSummary += `\n🧾 *Total: ${grandTotalStr}*\n\n📸 *Envie mais fotos* ou finalize!`;

                        await sendInteractiveButtons(
                          supabase, ctx, cartSummary,
                          [
                            { label: "✅ Sim, mais produto", id: "mais_produto" },
                            { label: "❌ Não, finalizar", id: "finalizar_compra" },
                            { label: "📋 Ver carrinho", id: "ver_carrinho" },
                          ],
                          "Nutricar Brasil - Mini Mercado 24h"
                        );
                        console.log(`[POST-LLM] BATCH: Auto-added ${first.name} (${unitPriceStr}) qty=1 — cart has ${cart.length} items, total=${grandTotalStr}`);
                      } else {
                        // First product — ask quantity as before
                        ctx.variables["_awaiting_quantity"] = "true";
                        const askQtyMsg = `🛒 Encontrei no catálogo: *${first.name}*\n💰 Valor unitário: *${unitPriceStr}*\n\n📦 *Quantas unidades você pegou?*\n\n_Responda com o número (ex: 1, 2, 3...)_`;
                        await sendWhatsAppMessage(supabase, ctx, askQtyMsg);
                        console.log(`[POST-LLM] Product found: ${first.name} (${unitPriceStr}) — asking quantity`);
                      }
                    } else {
                      // Product not in catalog
                      const notFound = `❌ Não encontrei esse produto no nosso catálogo${barcodeNum ? ` (código lido: ${barcodeNum})` : ""}. Poderia enviar outra foto mais nítida do código de barras ou me dizer o nome do produto?`;
                      await sendWhatsAppMessage(supabase, ctx, notFound);
                      console.log(`[POST-LLM] Product not found for barcode="${barcodeNum}" name="${productHint}"`);
                    }
                } else {
                  // No barcode detected — send the original LLM reply instead of generic error
                  if (shouldHoldPrimaryReply && reply) {
                    console.log("[POST-LLM] No barcode found — sending original LLM reply as fallback");
                    await sendWhatsAppMessage(supabase, ctx, reply);
                  } else {
                    const noBarcode = "⚠️ Não consegui identificar o código de barras nesta imagem. Pode reenviar com mais foco e iluminação?";
                    await sendWhatsAppMessage(supabase, ctx, noBarcode);
                  }
                  console.log("[POST-LLM] No readable barcode detected in image");
                }
            }
          } catch (e) {
            console.error("[POST-LLM] Barcode extraction error:", e);
          }
        }

        // ── AUTO-VERIFY RECEIPT: If client sends an image after PIX key was sent, auto-verify ──
        const pixKeySentRecently = ctx.variables["_pix_key_sent"] === "true";
        // Also check if PIX was sent in a PREVIOUS execution by looking at recent outbound messages
        let pixSentInPreviousExec = false;
        if (!pixKeySentRecently && imageBase64 && ctx.userId) {
          try {
            let recentPixQuery = supabase
              .from("messages")
              .select("content")
              .eq("contact_id", ctx.contactId)
              .eq("direction", "outbound")
              .order("created_at", { ascending: false })
              .limit(15);
            if (ctx.sessionStartedAt) recentPixQuery = recentPixQuery.gte("created_at", ctx.sessionStartedAt);
            const { data: recentPixMsgs } = await recentPixQuery;
            pixSentInPreviousExec = !!recentPixMsgs?.some((m: any) =>
              /financeiro@nutricarbrasil\.com\.br|chave\s*pix.*enviada|comprovante.*pix/i.test(m.content || "")
            );
          } catch {}
        }
        
        const shouldAutoVerifyReceipt = !!imageBase64 && !!ctx.userId && 
          (pixKeySentRecently || pixSentInPreviousExec) && 
          ctx.variables["comprovante_status"] !== "verificado";

        if (shouldAutoVerifyReceipt) {
          console.log(`[AUTO-VERIFY] PIX key was sent (current=${pixKeySentRecently}, previous=${pixSentInPreviousExec}) and client sent image — running receipt verification`);
          
          const expectedPixKey = "financeiro@nutricarbrasil.com.br";
          const expectedRecipient = "Nutricar Brasil";
          const expectedProductPrice = ctx.variables["produto_preco"] || "";
          const expectedProductName = ctx.variables["produto_nome"] || "";
          const maxHoursAgo = 24;
          
          const { keys: autoVerifyKeys } = await getUserAIKeys(supabase, ctx.userId);
          if (autoVerifyKeys.openai || autoVerifyKeys.gemini) {
            try {
              const verifyPrompt = `Você é um analista antifraude. Analise esta imagem:

PRIMEIRO: Determine se é um COMPROVANTE DE PAGAMENTO PIX. Se for código de barras, foto de produto, ou qualquer outra coisa que NÃO seja comprovante, retorne {"is_payment_receipt": false}.

Se FOR comprovante, valide contra estes dados:
- Chave PIX esperada: ${expectedPixKey}
- Favorecido esperado: ${expectedRecipient}
${expectedProductPrice ? `- Valor esperado: R$ ${Number(expectedProductPrice).toFixed(2)}` : "- Valor esperado: não informado"}
- Pagamento deve ser das últimas ${maxHoursAgo}h

CRITÉRIOS DE FRAUDE:
1. Chave PIX do destinatário diferente da esperada
2. Nome do favorecido NÃO contém "${expectedRecipient}"
3. Valor diferente do esperado (tolerância R$ 0.50)
4. Data/hora muito antiga
5. Imagem parece editada (fontes inconsistentes, artefatos, sobreposições)
6. Banco não reconhecido
7. Campos essenciais ilegíveis

Responda APENAS JSON:
{
  "is_payment_receipt": true/false,
  "recipient_name": "nome ou null",
  "recipient_key": "chave ou null",
  "amount": "valor numérico ou null",
  "payment_date": "ISO ou null",
  "bank_name": "banco ou null",
  "transaction_id": "ID ou null",
  "payer_name": "pagador ou null",
  "key_matches": true/false,
  "recipient_matches": true/false,
  "amount_matches": true/false/null,
  "date_valid": true/false/null,
  "visual_integrity": "ok"|"suspeito"|"editado",
  "visual_issues": "descrição ou null",
  "fraud_score": 0-100,
  "fraud_reasons": [],
  "verdict": "aprovado"|"suspeito"|"reprovado",
  "confidence": 0-100,
  "notes": "observações"
}`;

              const verifyReply = await callAIVisionWithUserKeys(autoVerifyKeys, verifyPrompt, imageBase64, { maxTokens: 800, temperature: 0.1 });
              if (verifyReply) {
                const jsonMatch = verifyReply.match(/\{[\s\S]*\}/);
                
                if (jsonMatch) {
                  const result = JSON.parse(jsonMatch[0]);
                  
                  if (result.is_payment_receipt) {
                    console.log(`[AUTO-VERIFY] Receipt verified! verdict=${result.verdict}, fraud_score=${result.fraud_score}, recipient="${result.recipient_name}", key_matches=${result.key_matches}`);
                    
                    // Store all results
                    ctx.variables["comprovante_status"] = "verificado";
                    ctx.variables["comprovante_valor"] = result.amount ? String(result.amount) : "";
                    ctx.variables["comprovante_destinatario"] = result.recipient_name || "";
                    ctx.variables["comprovante_chave"] = result.recipient_key || "";
                    ctx.variables["comprovante_fraud_score"] = String(result.fraud_score || 0);
                    ctx.variables["comprovante_integridade"] = result.visual_integrity || "";
                    
                    ctx.variables["_audit_payment_verify"] = JSON.stringify({
                      ts: new Date().toISOString(), auto_triggered: true,
                      verdict: result.verdict, fraud_score: result.fraud_score,
                      key_matches: result.key_matches, recipient_matches: result.recipient_matches,
                      amount_matches: result.amount_matches, amount_found: result.amount,
                      expected_amount: expectedProductPrice || "N/A",
                      visual_integrity: result.visual_integrity, fraud_reasons: result.fraud_reasons,
                    });
                    
                    // Send verdict to customer
                    if (result.verdict === "aprovado") {
                      let msg = "✅ *Pagamento confirmado com sucesso!*\n\n";
                      msg += `💰 Valor: *R$ ${Number(result.amount || 0).toFixed(2)}*\n`;
                      if (result.payer_name) msg += `👤 Pagador: ${result.payer_name}\n`;
                      if (result.bank_name) msg += `🏦 Banco: ${result.bank_name}\n`;
                      if (result.transaction_id) msg += `🔑 ID: ${result.transaction_id}\n`;
                      msg += `\nMuito obrigado pelo pagamento! Qualquer dúvida, estou por aqui 💚\n\n_Nutricar Brasil - Mini Mercado 24h_`;
                      await sendWhatsAppMessage(supabase, ctx, msg);
                    } else if (result.verdict === "suspeito") {
                      let msg = "⚠️ *Comprovante em verificação*\n\n";
                      msg += "Identificamos algumas inconsistências:\n\n";
                      if (!result.recipient_matches) msg += "• O *nome do favorecido* não corresponde à Nutricar Brasil\n";
                      if (!result.key_matches) msg += "• A *chave PIX* utilizada é diferente da esperada\n";
                      if (result.amount_matches === false) msg += "• O *valor* não confere com o produto\n";
                      if (result.visual_integrity !== "ok") msg += "• A imagem apresenta *possíveis sinais de edição*\n";
                      msg += "\nNossa equipe vai analisar e retornar em breve 📋\n\n_Nutricar Brasil - Mini Mercado 24h_";
                      await sendWhatsAppMessage(supabase, ctx, msg);
                    } else {
                      let msg = "❌ *Comprovante não validado*\n\n";
                      msg += "O comprovante não corresponde ao pagamento esperado.\n\n";
                      msg += "Por favor, verifique:\n";
                      msg += `• Chave PIX correta: *${expectedPixKey}*\n`;
                      msg += `• Favorecido: *${expectedRecipient}*\n`;
                      if (expectedProductPrice) msg += `• Valor: *R$ ${Number(expectedProductPrice).toFixed(2)}*\n`;
                      msg += "\nSe tiver dúvidas, estou aqui pra ajudar! 😊\n\n_Nutricar Brasil - Mini Mercado 24h_";
                      await sendWhatsAppMessage(supabase, ctx, msg);
                    }
                    
                    // Auto-tag suspicious
                    if ((result.verdict === "suspeito" || result.verdict === "reprovado") && ctx.contactId) {
                      try {
                        const fraudTagName = "comprovante-suspeito";
                        let { data: eTag } = await supabase.from("tags").select("id").eq("name", fraudTagName).eq("created_by", ctx.userId).maybeSingle();
                        if (!eTag) {
                          const { data: nTag } = await supabase.from("tags").insert({ name: fraudTagName, color: "#ef4444", created_by: ctx.userId }).select("id").single();
                          eTag = nTag;
                        }
                        if (eTag) {
                          await supabase.from("contact_tags").upsert({ contact_id: ctx.contactId, tag_id: eTag.id }, { onConflict: "contact_id,tag_id" });
                          console.log(`[AUTO-VERIFY] Tagged contact as "${fraudTagName}"`);
                        }
                      } catch (e) { console.error("[AUTO-VERIFY] Tag error:", e); }
                    }
                    
                    return { sent: true, model, reply: `[auto-verify: ${result.verdict}]`, auto_verify: true, verdict: result.verdict };
                  } else {
                    console.log("[AUTO-VERIFY] Image is NOT a payment receipt — continuing normal flow");
                  }
                }
              }
            } catch (e) {
              console.error("[AUTO-VERIFY] Receipt verification error:", e);
            }
          }
        }

        // After replying, automatically send PIX key if the conversation is about payment
        const pixSent = await sendPixKeyIfPaymentRelated(supabase, ctx);

        // ── PROMISE FULFILLMENT SAFETY NET ──
        // Detect when the AI promised to verify/check/send something but no concrete action followed
        // This prevents the customer from being left "on hold" with no response
        if (!pixSent && !d.suppress_send) {
          const originalReply = ctx.variables["ia_reply"] || reply || "";
          const promisedVerify = /\b(vou\s+(verificar|checar|consultar|buscar|conferir|olhar|pesquisar)|deixa\s+eu\s+(ver|verificar|checar|consultar)|j[aá]\s+(te\s+)?(informo|retorno|passo|aviso|digo)|um\s+momento|um\s+instante|aguarde|vou\s+ver\s+(isso|aqui)|vou\s+dar\s+uma\s+(olhada|verificada))\b/i.test(originalReply);
          const promisedPixSend = /\b(vou\s+(te\s+)?(enviar|mandar|passar)\s*(a\s+)?chave|enviar(ei)?\s*(a\s+)?chave\s*pix|mando\s*(a\s+)?chave|passo\s*(a\s+)?chave)\b/i.test(originalReply);
          const promisedValue = /\b(vou\s+(te\s+)?(informar|passar|dizer)\s*(o\s+)?valor|j[aá]\s+(te\s+)?passo\s*(o\s+)?valor|vou\s+consultar\s*(o\s+)?(valor|pre[cç]o))\b/i.test(originalReply);
          
          const nothingDelivered = 
            ctx.variables["_pix_key_sent"] !== "true" && 
            ctx.variables["_pix_buttons_sent"] !== "true" && 
            ctx.variables["produto_encontrado"] !== "true" &&
            ctx.variables["_difficulty_detected"] !== "true" &&
            ctx.variables["_escalated_to_human"] !== "true";

          if ((promisedVerify || promisedPixSend || promisedValue) && nothingDelivered) {
            const promiseType = promisedPixSend ? "PIX" : promisedValue ? "valor" : "verificação";
            console.log(`[PROMISE GUARD] AI promised "${promiseType}" but no follow-up action executed — sending fulfillment fallback`);
            
            // Try to actually fulfill the promise with a concrete action
            const { keys: fulfillKeys } = await getUserAIKeys(supabase, ctx.userId);
            let fulfilled = false;
            
            // If we have product context, try searching the catalog
            if ((fulfillKeys.openai || fulfillKeys.gemini) && ctx.userId) {
              const searchContext = [
                ctx.messageContent,
                ctx.variables["mensagens_agrupadas"] || "",
                ctx.variables["transcricao"] || "",
                ctx.variables["produto_identificado"] || "",
                ctx.variables["descricao_imagem"] || "",
              ].join(" ");
              
              // Extract product-related terms
              const stopWords = new Set(["para", "como", "quero", "saber", "qual", "esse", "essa", "favor", "pode", "aqui", "mais", "muito", "obrigado", "sobre", "tenho", "estou", "esta", "isso", "peguei", "produto", "valor", "preco", "pagar", "pagamento", "chave", "enviar", "envia", "mandar", "quiser"]);
              const words = searchContext
                .replace(/[^\p{L}\p{N}\s]/gu, " ")
                .split(/\s+/)
                .filter((w: string) => w.length > 3 && !stopWords.has(w.toLowerCase()));
              const query = words.slice(0, 5).join(" ");
              
              if (query.length > 2) {
                try {
                  const { data: products } = await supabase.rpc("search_products", {
                    _user_id: ctx.userId,
                    _query: query,
                    _limit: 3,
                  });
                  if (products && products.length > 0) {
                    const first = products[0];
                    ctx.variables["produto_encontrado"] = "true";
                    ctx.variables["produto_nome"] = first.name || "";
                    ctx.variables["produto_preco"] = String(first.price || 0);
                    ctx.variables["_awaiting_quantity"] = "true";
                    const prodPrice = Number(first.price).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
                    
                    // Ask quantity instead of showing PIX buttons directly
                    const askQtyMsg = `🛒 Encontrei no catálogo: *${first.name}*\n💰 Valor unitário: *${prodPrice}*\n\n📦 *Quantas unidades você pegou?*\n\n_Responda com o número (ex: 1, 2, 3...)_`;
                    await sendWhatsAppMessage(supabase, ctx, askQtyMsg);
                    fulfilled = true;
                    console.log(`[PROMISE GUARD] Fulfilled! Found product: ${first.name} = ${prodPrice} — asking quantity`);
                  }
                } catch (e) {
                  console.error("[PROMISE GUARD] Product search error:", e);
                }
              }
            }
            
            // If we couldn't fulfill, send a follow-up asking for what we need
            if (!fulfilled) {
              const followUpMsg = `📸 Para te passar o valor certinho e a chave PIX, preciso identificar o produto!\n\nPor favor, envie uma *foto do código de barras* do produto que você pegou. 🔍\n\nAssim consigo buscar no sistema rapidinho! 😊\n\n_Nutricar Brasil - Mini Mercado 24h_ 💚`;
              await sendWhatsAppMessage(supabase, ctx, followUpMsg);
              ctx.variables["_audit_promise_guard"] = `AI prometeu "${promiseType}" mas nada foi entregue. Enviado follow-up pedindo código de barras.`;
              console.log(`[PROMISE GUARD] Could not fulfill — sent follow-up asking for barcode`);
            }
          }
        }
      }
      return { sent: !!reply, model, reply: (reply || "").slice(0, 80), suppressed: !!d.suppress_send };
    }

    if (type === "action_elevenlabs_tts") {
      const text = interpolate(String(d.text || ""), ctx);
      if (!text) return { sent: false, reason: "empty_text" };

      const voiceId = d.voice_id || "EXAVITQu4vr4xnSDxMaL";
      const audioResult = await sendElevenLabsAudioFromText(supabase, ctx, text, voiceId);

      if (audioResult.sent) {
        return { sent: true, tts: true, voiceId };
      }

      if (audioResult.reason === "no_elevenlabs_key" || audioResult.reason === "tts_api_error") {
        // Fallback: send as text message
        await sendWhatsAppMessage(supabase, ctx, text);
        return { sent: true, fallback: "text", reason: audioResult.reason };
      }

      return { sent: false, reason: audioResult.reason || "tts_failed" };
    }

    if (type === "action_ab_split") {
      const splitPct = parseInt(d.split_percentage) || 50;
      return Math.random() * 100 < splitPct; // true = path A, false = path B
    }

    // ── SEARCH PRODUCT NODE ──
    if (type === "action_search_product") {
      const searchSource = d.search_source || "message";
      const maxResults = parseInt(d.max_results) || 5;
      const sendResult = d.send_result !== false;
      const resultTemplate = String(d.result_template || "").trim();
      const notFoundMsg = interpolate(String(d.not_found_message || "Não encontrei esse produto no catálogo."), ctx);

      // Determine search query based on source
      let searchQuery = "";
      if (searchSource === "variable") {
        const varName = String(d.search_variable || "produto_identificado").trim();
        searchQuery = ctx.variables[varName] || "";
      } else if (searchSource === "fixed") {
        searchQuery = interpolate(String(d.search_term || ""), ctx);
      } else {
        // "message" — extract product-related terms from the message
        const grouped = ctx.variables["mensagens_agrupadas"] || "";
        const rawText = grouped || ctx.messageContent || "";
        // Remove common filler words to get better search terms
        const stopWords = ["qual", "quanto", "custa", "preço", "valor", "do", "da", "de", "o", "a", "um", "uma", "por", "favor", "me", "quero", "tem", "voces", "vocês", "esse", "essa", "desse", "dessa", "aquele", "aquela"];
        const words = rawText
          .toLowerCase()
          .replace(/[^\w\sáàâãéèêíìîóòôõúùûç]/g, "")
          .split(/\s+/)
          .filter((w: string) => w.length > 2 && !stopWords.includes(w));
        searchQuery = words.slice(0, 6).join(" ");
      }

      if (!searchQuery || searchQuery.length < 2) {
        ctx.variables["produto_encontrado"] = "false";
        ctx.variables["produtos_lista"] = "";
        ctx.variables["produto_nome"] = "";
        ctx.variables["produto_preco"] = "";
        ctx.variables["produto_categoria"] = "";
        if (sendResult && notFoundMsg) {
          await sendWhatsAppMessage(supabase, ctx, notFoundMsg);
        }
        return { found: false, reason: "empty_query", query: searchQuery };
      }

      console.log(`[SEARCH_PRODUCT] Query: "${searchQuery}", max: ${maxResults}, userId: ${ctx.userId}`);

      // Call search_products RPC
      const { data: products, error: searchErr } = await supabase.rpc("search_products", {
        _user_id: ctx.userId,
        _query: searchQuery,
        _limit: maxResults,
      });

      if (searchErr) {
        console.error("[SEARCH_PRODUCT] RPC error:", searchErr);
        ctx.variables["produto_encontrado"] = "false";
        return { found: false, reason: "rpc_error", error: searchErr.message };
      }

      if (!products || products.length === 0) {
        ctx.variables["produto_encontrado"] = "false";
        ctx.variables["produtos_lista"] = "";
        ctx.variables["produto_nome"] = "";
        ctx.variables["produto_preco"] = "";
        ctx.variables["produto_categoria"] = "";
        if (sendResult && notFoundMsg) {
          await sendWhatsAppMessage(supabase, ctx, notFoundMsg);
        }
        console.log(`[SEARCH_PRODUCT] No results for "${searchQuery}"`);
        return { found: false, query: searchQuery };
      }

      // Store first result in variables for easy access
      const first = products[0];
      ctx.variables["produto_encontrado"] = "true";
      ctx.variables["produto_nome"] = first.name || "";
      ctx.variables["produto_preco"] = String(first.price || 0);
      ctx.variables["produto_categoria"] = first.category || "";
      ctx.variables["produto_barcode"] = first.barcode || "";
      ctx.variables["produtos_quantidade"] = String(products.length);

      // Build formatted product list
      const productList = products.map((p: any, i: number) => {
        const priceFormatted = Number(p.price || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        return `${i + 1}. *${p.name}* — ${priceFormatted}${p.category ? ` (${p.category})` : ""}${p.barcode ? ` | Cód: ${p.barcode}` : ""}`;
      }).join("\n");
      ctx.variables["produtos_lista"] = productList;

      // Send result to client
      if (sendResult) {
        let message = "";
        if (resultTemplate) {
          message = interpolate(resultTemplate.replace(/\{\{produtos\}\}/gi, productList), ctx);
        } else {
          if (products.length === 1) {
            const priceFormatted = Number(first.price || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
            message = `✅ Encontrei: *${first.name}*\n💰 Preço: ${priceFormatted}${first.category ? `\n📦 Categoria: ${first.category}` : ""}`;
          } else {
            message = `📋 Encontrei ${products.length} produto(s):\n\n${productList}`;
          }
        }
        await sendWhatsAppMessage(supabase, ctx, message);
      }

      console.log(`[SEARCH_PRODUCT] Found ${products.length} for "${searchQuery}"`);
      return { found: true, count: products.length, query: searchQuery, first: first.name };
    }

    // ── ANALYZE IMAGE NODE ──
    if (type === "action_analyze_image") {
      const analysisType = d.analysis_type || "product_identify";
      const customPrompt = d.custom_prompt || "";
      const searchCatalog = d.search_catalog !== false;
      const sendResult = d.send_result !== false;

      // Find last image from contact (from collect or recent messages)
      let imageUrl = ctx.variables["imagem_url"] || "";
      if (!imageUrl) {
        const { data: imgMsgs } = await supabase
          .from("messages")
          .select("media_url")
          .eq("contact_id", ctx.contactId)
          .eq("direction", "inbound")
          .eq("type", "image")
          .order("created_at", { ascending: false })
          .limit(1);
        imageUrl = imgMsgs?.[0]?.media_url || "";
      }

      if (!imageUrl) {
        const noImageMsg = "Não encontrei nenhuma imagem para analisar. Por favor, envie uma foto do produto ou do código de barras. 📸";
        if (sendResult) await sendWhatsAppMessage(supabase, ctx, noImageMsg);
        ctx.variables["imagem_analise"] = "";
        ctx.variables["produto_identificado"] = "";
        ctx.variables["imagem_qualidade"] = "sem_imagem";
        return { analyzed: false, reason: "no_image" };
      }

      // Download image → base64
      let imgBase64 = "";
      try {
        const imgResp = await fetch(imageUrl);
        if (!imgResp.ok) throw new Error(`Download failed: ${imgResp.status}`);
        const imgBuffer = await imgResp.arrayBuffer();
        const { encode: base64Encode } = await import("https://deno.land/std@0.168.0/encoding/base64.ts");
        imgBase64 = base64Encode(imgBuffer);
        console.log(`[IMAGE ANALYSIS] Downloaded image (${Math.round(imgBuffer.byteLength / 1024)}KB)`);
      } catch (e) {
        console.error("[IMAGE ANALYSIS] Failed to download:", e);
        if (sendResult) await sendWhatsAppMessage(supabase, ctx, "Não consegui processar a imagem. Pode tentar enviar novamente? 📸");
        ctx.variables["imagem_qualidade"] = "erro_download";
        return { analyzed: false, reason: "download_failed" };
      }

      // Build analysis prompt based on type
      const analysisPrompts: Record<string, string> = {
        product_identify: `Você é um especialista em identificação de produtos da Nutricar Brasil (rede de mini mercados autônomos 24h).

Analise esta imagem cuidadosamente e tente identificar o produto mostrado.

PROCESSO DE ANÁLISE:
1. Primeiro, avalie a QUALIDADE da imagem:
   - A imagem está nítida o suficiente para identificar o produto?
   - O produto ou rótulo está visível e legível?
   - A iluminação é adequada?

2. Se a imagem for ADEQUADA:
   - Identifique o nome do produto (marca, tipo, variante)
   - PRIORIDADE MÁXIMA: Leia o código de barras se visível — leia CADA DÍGITO individualmente da esquerda para direita (EAN-13 = 13 dígitos, geralmente começa com 789 no Brasil). Se houver números impressos ABAIXO das barras, use-os.
   - Identifique o peso/volume se visível
   - Identifique a marca/fabricante
   - Estime a categoria (bebidas, laticínios, snacks, higiene, limpeza, etc.)

3. Se a imagem NÃO for adequada:
   - Explique o que está errado (desfocada, escura, produto não visível, etc.)
   - Sugira como tirar uma foto melhor

${customPrompt ? `INSTRUÇÃO ADICIONAL: ${customPrompt}` : ""}

Responda APENAS com JSON válido:
{
  "quality": "boa" | "ruim" | "parcial",
  "quality_issue": "descrição do problema se quality != boa, ou null",
  "identified": true/false,
  "product_name": "nome completo do produto ou null",
  "brand": "marca ou null",
  "barcode": "APENAS dígitos numéricos sem espaços (ex: 7891234567890) ou null",
  "weight_volume": "peso ou volume se visível ou null",
  "category": "categoria estimada ou null",
  "confidence": 0-100,
  "description": "descrição breve do que foi visto na imagem",
  "suggestion": "sugestão para melhorar a foto se quality != boa, ou null"
}`,
        barcode_read: `Você é um LEITOR DE CÓDIGO DE BARRAS ultra-preciso. Sua ÚNICA tarefa é ler os DÍGITOS NUMÉRICOS do código de barras na imagem.

INSTRUÇÕES CRÍTICAS:
1. Localize o código de barras na imagem (pode ser EAN-13, EAN-8, UPC-A, Code128, QR Code)
2. Leia CADA DÍGITO individualmente, da ESQUERDA para a DIREITA
3. Códigos EAN-13 têm EXATAMENTE 13 dígitos (ex: 7891234567890)
4. Códigos EAN-8 têm EXATAMENTE 8 dígitos
5. Se não conseguir ler com 100% de certeza algum dígito, coloque "?" no lugar
6. NUNCA invente números — é melhor retornar "?" do que chutar
7. Se houver números impressos ABAIXO das barras, use-os como referência principal
8. Verifique se o primeiro dígito é 7 (Brasil) — códigos brasileiros geralmente começam com 789
${customPrompt ? `INSTRUÇÃO ADICIONAL: ${customPrompt}` : ""}

Responda APENAS com JSON válido:
{"quality": "boa"|"ruim"|"parcial", "quality_issue": "descrição se != boa ou null", "barcode": "APENAS os dígitos numéricos sem espaços ou null", "barcode_type": "EAN-13|EAN-8|UPC|QR|outro", "confidence": 0-100, "identified": true/false, "product_name": null, "brand": null, "category": null, "description": "o que você vê na imagem", "suggestion": "dica para melhorar a foto se necessário ou null"}`,
        label_read: `Analise esta imagem e leia todas as informações do rótulo/etiqueta do produto (nome, ingredientes, validade, peso, preço, etc.).
${customPrompt ? `INSTRUÇÃO: ${customPrompt}` : ""}
Responda com JSON: {"quality": "boa"|"ruim"|"parcial", "quality_issue": "...", "identified": true/false, "product_name": "...", "brand": "...", "barcode": "...", "weight_volume": "...", "category": "...", "expiry_date": "...", "price_on_label": "...", "ingredients": "...", "confidence": 0-100, "description": "...", "suggestion": "..."}`,
        general: `Analise esta imagem e descreva detalhadamente o que você vê.
${customPrompt ? `INSTRUÇÃO: ${customPrompt}` : ""}
Responda com JSON: {"quality": "boa"|"ruim"|"parcial", "quality_issue": "...", "identified": false, "product_name": null, "brand": null, "barcode": null, "category": null, "confidence": 0-100, "description": "descrição detalhada", "suggestion": null}`,
      };

      const visionPrompt = analysisPrompts[analysisType] || analysisPrompts.product_identify;

      // Call AI with vision using user keys
      const { keys: imgKeys } = await getUserAIKeys(supabase, ctx.userId);
      if (!imgKeys.openai && !imgKeys.gemini) {
        console.error("[IMAGE ANALYSIS] No AI keys configured");
        return { analyzed: false, reason: "no_ai_key" };
      }

      let analysisResult: any = null;
      try {
        const reply = await callAIVisionWithUserKeys(imgKeys, visionPrompt, imgBase64, { maxTokens: 600, temperature: 0.2 });
        if (!reply) throw new Error("AI returned empty response");
        const jsonMatch = reply.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          analysisResult = JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        console.error("[IMAGE ANALYSIS] Vision error:", e);
        if (sendResult) await sendWhatsAppMessage(supabase, ctx, "Tive dificuldade para analisar a imagem. Pode tentar enviar novamente com mais nitidez? 📸");
        return { analyzed: false, reason: "vision_error" };
      }

      if (!analysisResult) {
        if (sendResult) await sendWhatsAppMessage(supabase, ctx, "Não consegui interpretar a imagem. Tente enviar uma foto mais nítida do produto ou do código de barras. 📸");
        return { analyzed: false, reason: "parse_error" };
      }

      // Store results in variables
      ctx.variables["imagem_qualidade"] = analysisResult.quality || "desconhecido";
      ctx.variables["imagem_analise"] = analysisResult.description || "";
      ctx.variables["produto_identificado"] = analysisResult.product_name || "";
      ctx.variables["produto_marca"] = analysisResult.brand || "";
      ctx.variables["produto_barcode"] = analysisResult.barcode || "";
      ctx.variables["produto_categoria"] = analysisResult.category || "";
      ctx.variables["imagem_confianca"] = String(analysisResult.confidence || 0);

      console.log(`[IMAGE ANALYSIS] quality=${analysisResult.quality}, identified=${analysisResult.identified}, product="${analysisResult.product_name}", confidence=${analysisResult.confidence}%`);

      // ── Handle poor quality images ──
      if (analysisResult.quality === "ruim") {
        const poorQualityMsg = analysisResult.suggestion
          ? `A imagem não ficou muito clara para eu identificar o produto. 😕\n\n💡 *Dica:* ${analysisResult.suggestion}\n\nPode tentar enviar outra foto? 📸`
          : "A imagem está um pouco difícil de ler. Pode enviar outra foto com mais iluminação e foco no produto ou rótulo? 📸";
        if (sendResult) await sendWhatsAppMessage(supabase, ctx, poorQualityMsg);
        return { analyzed: true, quality: "ruim", identified: false, suggestion: analysisResult.suggestion };
      }

      // ── Product identified — search catalog if enabled ──
      let catalogMatch = "";
      if (searchCatalog && ctx.userId) {
        // Clean barcode: remove spaces, dashes, question marks, non-digits
        const rawBarcode = (analysisResult.barcode || "").replace(/[\s\-\.?]/g, "");
        const cleanBarcode = /^\d{8,13}$/.test(rawBarcode) ? rawBarcode : "";
        
        if (cleanBarcode) {
          console.log(`[IMAGE ANALYSIS] Clean barcode: "${cleanBarcode}" (raw: "${analysisResult.barcode}")`);
        }

        try {
          // Strategy 1: Exact barcode search
          if (cleanBarcode) {
            const { data: barcodeProducts } = await supabase.rpc("search_products", {
              _user_id: ctx.userId,
              _query: cleanBarcode,
              _limit: 3,
            });
            if (barcodeProducts?.length > 0) {
              catalogMatch = barcodeProducts.map((p: any) =>
                `• ${p.name}${p.barcode ? ` (cód: ${p.barcode})` : ""}: *R$ ${Number(p.price).toFixed(2)}*${p.category ? ` [${p.category}]` : ""}`
              ).join("\n");
              ctx.variables["produto_preco"] = String(barcodeProducts[0].price);
              ctx.variables["produto_nome_catalogo"] = barcodeProducts[0].name;
              console.log(`[IMAGE ANALYSIS] ✅ Barcode exact match: ${barcodeProducts[0].name}`);
            }
          }

          // Strategy 2: Partial barcode (without last digit — check digit often misread)
          if (!catalogMatch && cleanBarcode && cleanBarcode.length >= 8) {
            const partialBarcode = cleanBarcode.slice(0, -1);
            const { data: partialProducts } = await supabase
              .from("products")
              .select("id, name, barcode, price, category")
              .eq("user_id", ctx.userId)
              .eq("is_active", true)
              .like("barcode", `${partialBarcode}%`)
              .limit(3);
            if (partialProducts?.length > 0) {
              catalogMatch = partialProducts.map((p: any) =>
                `• ${p.name}${p.barcode ? ` (cód: ${p.barcode})` : ""}: *R$ ${Number(p.price).toFixed(2)}*${p.category ? ` [${p.category}]` : ""}`
              ).join("\n");
              ctx.variables["produto_preco"] = String(partialProducts[0].price);
              ctx.variables["produto_nome_catalogo"] = partialProducts[0].name;
              console.log(`[IMAGE ANALYSIS] ✅ Barcode partial match (${partialBarcode}%): ${partialProducts[0].name}`);
            }
          }

          // Strategy 3: Fallback to product name search
          if (!catalogMatch && analysisResult.identified && analysisResult.product_name) {
            const { data: nameProducts } = await supabase.rpc("search_products", {
              _user_id: ctx.userId,
              _query: analysisResult.product_name,
              _limit: 3,
            });
            if (nameProducts?.length > 0) {
              catalogMatch = nameProducts.map((p: any) =>
                `• ${p.name}${p.barcode ? ` (cód: ${p.barcode})` : ""}: *R$ ${Number(p.price).toFixed(2)}*${p.category ? ` [${p.category}]` : ""}`
              ).join("\n");
              ctx.variables["produto_preco"] = String(nameProducts[0].price);
              ctx.variables["produto_nome_catalogo"] = nameProducts[0].name;
              console.log(`[IMAGE ANALYSIS] ✅ Name match: ${nameProducts[0].name}`);
            }
          }

          // Strategy 4: Brand search as last resort
          if (!catalogMatch && analysisResult.brand) {
            const { data: brandProducts } = await supabase.rpc("search_products", {
              _user_id: ctx.userId,
              _query: analysisResult.brand,
              _limit: 3,
            });
            if (brandProducts?.length > 0) {
              catalogMatch = brandProducts.map((p: any) =>
                `• ${p.name}${p.barcode ? ` (cód: ${p.barcode})` : ""}: *R$ ${Number(p.price).toFixed(2)}*${p.category ? ` [${p.category}]` : ""}`
              ).join("\n");
              ctx.variables["produto_preco"] = String(brandProducts[0].price);
              ctx.variables["produto_nome_catalogo"] = brandProducts[0].name;
              console.log(`[IMAGE ANALYSIS] ✅ Brand match: ${brandProducts[0].name}`);
            }
          }
        } catch (e) {
          console.error("[IMAGE ANALYSIS] Catalog search error:", e);
        }
      }

      // ── Build response message ──
      if (sendResult) {
        let responseMsg = "";

        if (analysisResult.identified && analysisResult.confidence >= 60) {
          responseMsg = `Identifiquei o produto! 🔍\n\n📦 *${analysisResult.product_name}*`;
          if (analysisResult.brand) responseMsg += `\n🏷️ Marca: ${analysisResult.brand}`;
          if (analysisResult.barcode) responseMsg += `\n📊 Código: ${analysisResult.barcode}`;
          if (analysisResult.weight_volume) responseMsg += `\n⚖️ ${analysisResult.weight_volume}`;

          if (catalogMatch) {
            responseMsg += `\n\n💰 *Preço no catálogo:*\n${catalogMatch}`;
          } else if (searchCatalog) {
            responseMsg += `\n\n⚠️ Este produto não foi encontrado no nosso catálogo. Pode enviar outra foto mais nítida do código de barras? 📸`;
          }
        } else if (analysisResult.quality === "parcial") {
          responseMsg = `Consegui ver parcialmente o produto, mas não tenho certeza. 🤔\n\n${analysisResult.description || ""}`;
          if (analysisResult.suggestion) responseMsg += `\n\n💡 *Dica:* ${analysisResult.suggestion}`;
          responseMsg += `\n\nPode enviar outra foto mais nítida do rótulo ou código de barras? 📸`;
        } else {
          responseMsg = `Não consegui identificar o produto com certeza. 😕\n\n${analysisResult.description || ""}`;
          responseMsg += `\n\n💡 Para melhor identificação, tente:\n• Foto do *rótulo frontal* com boa iluminação\n• Foto do *código de barras* (números visíveis)\n• Foto mais *próxima* do produto`;
        }

        await sendWhatsAppMessage(supabase, ctx, responseMsg);
      }

      return {
        analyzed: true,
        quality: analysisResult.quality,
        identified: analysisResult.identified,
        product: analysisResult.product_name,
        barcode: analysisResult.barcode,
        confidence: analysisResult.confidence,
        catalogFound: !!catalogMatch,
      };
    }

    // ── VERIFY PAYMENT RECEIPT NODE ──
    if (type === "action_verify_payment") {
      const expectedPixKey = d.expected_pix_key || "financeiro@nutricarbrasil.com.br";
      const expectedRecipient = (d.expected_recipient || "Nutricar Brasil").toLowerCase();
      const checkValue = d.check_value !== false;
      const maxHoursAgo = parseInt(d.max_hours_ago) || 24;
      const sendResult = d.send_result !== false;
      const autoTagFraud = d.auto_tag_fraud !== false;
      const fraudTag = d.fraud_tag || "comprovante-suspeito";

      // Find last image from contact
      let imageUrl = ctx.variables["imagem_url"] || "";
      if (!imageUrl) {
        const { data: imgMsgs } = await supabase
          .from("messages")
          .select("media_url")
          .eq("contact_id", ctx.contactId)
          .eq("direction", "inbound")
          .eq("type", "image")
          .order("created_at", { ascending: false })
          .limit(1);
        imageUrl = imgMsgs?.[0]?.media_url || "";
      }

      if (!imageUrl) {
        const noImg = "Para confirmar o pagamento, preciso que envie uma *foto ou print do comprovante PIX*. 📸";
        if (sendResult) await sendWhatsAppMessage(supabase, ctx, noImg);
        ctx.variables["comprovante_status"] = "sem_imagem";
        return { verified: false, reason: "no_image" };
      }

      // Download image → base64
      let imgBase64 = "";
      try {
        const imgResp = await fetch(imageUrl);
        if (!imgResp.ok) throw new Error(`Download failed: ${imgResp.status}`);
        const imgBuffer = await imgResp.arrayBuffer();
        const { encode: base64Encode } = await import("https://deno.land/std@0.168.0/encoding/base64.ts");
        imgBase64 = base64Encode(imgBuffer);
      } catch (e) {
        console.error("[VERIFY PAYMENT] Failed to download image:", e);
        if (sendResult) await sendWhatsAppMessage(supabase, ctx, "Não consegui processar a imagem do comprovante. Pode enviar novamente? 📸");
        ctx.variables["comprovante_status"] = "erro_download";
        return { verified: false, reason: "download_failed" };
      }

      const { keys: payKeys } = await getUserAIKeys(supabase, ctx.userId);
      if (!payKeys.openai && !payKeys.gemini) {
        console.error("[VERIFY PAYMENT] No AI keys configured");
        return { verified: false, reason: "no_ai_key" };
      }

      const expectedProductPrice = ctx.variables["produto_preco"] || "";
      const expectedProductName = ctx.variables["produto_nome"] || ctx.variables["produto_nome_catalogo"] || "";

      const visionPrompt = `Você é um analista antifraude especializado em comprovantes de pagamento PIX.

Analise esta imagem de comprovante PIX e extraia TODAS as informações visíveis.

DADOS ESPERADOS PARA VALIDAÇÃO:
- Chave PIX do recebedor: ${expectedPixKey}
- Nome do recebedor esperado: ${d.expected_recipient || "Nutricar Brasil"}
${checkValue && expectedProductPrice ? `- Valor esperado: R$ ${Number(expectedProductPrice).toFixed(2)}` : "- Valor esperado: não informado"}
${expectedProductName ? `- Produto: ${expectedProductName}` : ""}
- O pagamento deve ter sido realizado nas últimas ${maxHoursAgo} horas

CRITÉRIOS DE FRAUDE — marque como SUSPEITO se:
1. A chave PIX do destinatário NÃO corresponde à esperada
2. O nome do recebedor NÃO contém "${d.expected_recipient || "Nutricar Brasil"}" (ou variações próximas)
3. O valor pago é significativamente diferente do esperado (tolerância de R$ 0.50)
4. A data/hora do pagamento é muito antiga (mais de ${maxHoursAgo}h)
5. A imagem parece editada, com artefatos visuais, fontes inconsistentes ou elementos sobrepostos
6. O comprovante não é de uma instituição bancária reconhecida
7. Campos essenciais estão ilegíveis ou ausentes (valor, destinatário, data)
8. A imagem NÃO é um comprovante de pagamento (é outra coisa)

Responda APENAS com JSON válido:
{
  "is_payment_receipt": true/false,
  "recipient_name": "nome do recebedor visível ou null",
  "recipient_key": "chave PIX do recebedor visível ou null",
  "amount": "valor numérico (ex: 99.00) ou null",
  "payment_date": "data/hora do pagamento (ISO) ou null",
  "bank_name": "nome do banco/instituição ou null",
  "transaction_id": "ID da transação se visível ou null",
  "payer_name": "nome do pagador se visível ou null",
  "key_matches": true/false,
  "recipient_matches": true/false,
  "amount_matches": true/false/null,
  "date_valid": true/false/null,
  "visual_integrity": "ok" | "suspeito" | "editado",
  "visual_issues": "descrição de problemas visuais ou null",
  "fraud_score": 0-100,
  "fraud_reasons": ["lista de motivos de suspeita"],
  "verdict": "aprovado" | "suspeito" | "reprovado",
  "confidence": 0-100,
  "notes": "observações adicionais"
}`;

      let analysisResult: any = null;
      try {
        const reply = await callAIVisionWithUserKeys(payKeys, visionPrompt, imgBase64, { maxTokens: 800, temperature: 0.1 });
        if (!reply) throw new Error("AI returned empty response");
        const jsonMatch = reply.match(/\{[\s\S]*\}/);
        if (jsonMatch) analysisResult = JSON.parse(jsonMatch[0]);
      } catch (e) {
        console.error("[VERIFY PAYMENT] Vision error:", e);
        if (sendResult) await sendWhatsAppMessage(supabase, ctx, "Tive dificuldade para analisar o comprovante. Pode enviar novamente com mais nitidez? 📸");
        ctx.variables["comprovante_status"] = "erro_analise";
        return { verified: false, reason: "vision_error" };
      }

      if (!analysisResult) {
        if (sendResult) await sendWhatsAppMessage(supabase, ctx, "Não consegui interpretar o comprovante. Tente enviar uma foto mais nítida. 📸");
        ctx.variables["comprovante_status"] = "erro_parse";
        return { verified: false, reason: "parse_error" };
      }

      // Store all results
      ctx.variables["comprovante_status"] = analysisResult.verdict || "desconhecido";
      ctx.variables["comprovante_valor"] = analysisResult.amount ? String(analysisResult.amount) : "";
      ctx.variables["comprovante_destinatario"] = analysisResult.recipient_name || "";
      ctx.variables["comprovante_chave"] = analysisResult.recipient_key || "";
      ctx.variables["comprovante_banco"] = analysisResult.bank_name || "";
      ctx.variables["comprovante_data"] = analysisResult.payment_date || "";
      ctx.variables["comprovante_pagador"] = analysisResult.payer_name || "";
      ctx.variables["comprovante_transacao_id"] = analysisResult.transaction_id || "";
      ctx.variables["comprovante_fraud_score"] = String(analysisResult.fraud_score || 0);
      ctx.variables["comprovante_integridade"] = analysisResult.visual_integrity || "";

      // Audit log
      ctx.variables["_audit_payment_verify"] = JSON.stringify({
        ts: new Date().toISOString(),
        verdict: analysisResult.verdict,
        fraud_score: analysisResult.fraud_score,
        key_matches: analysisResult.key_matches,
        recipient_matches: analysisResult.recipient_matches,
        amount_matches: analysisResult.amount_matches,
        amount_found: analysisResult.amount,
        expected_amount: expectedProductPrice || "N/A",
        visual_integrity: analysisResult.visual_integrity,
        fraud_reasons: analysisResult.fraud_reasons,
      });
      console.log(`[AUDIT] Payment verification at ${new Date().toISOString()} — verdict: ${analysisResult.verdict}, fraud_score: ${analysisResult.fraud_score}, key_matches: ${analysisResult.key_matches}`);

      // Not a payment receipt at all
      if (!analysisResult.is_payment_receipt) {
        if (sendResult) await sendWhatsAppMessage(supabase, ctx, "Esta imagem não parece ser um comprovante de pagamento. 🤔\n\nPor favor, envie o *print ou foto do comprovante PIX* após realizar o pagamento. 💳");
        ctx.variables["comprovante_status"] = "nao_e_comprovante";
        return { verified: false, reason: "not_receipt", ...analysisResult };
      }

      // Build response based on verdict
      if (sendResult) {
        if (analysisResult.verdict === "aprovado") {
          let msg = "✅ *Comprovante verificado com sucesso!*\n\n";
          msg += `💰 Valor: R$ ${Number(analysisResult.amount || 0).toFixed(2)}\n`;
          if (analysisResult.payer_name) msg += `👤 Pagador: ${analysisResult.payer_name}\n`;
          if (analysisResult.bank_name) msg += `🏦 Banco: ${analysisResult.bank_name}\n`;
          if (analysisResult.transaction_id) msg += `🔑 ID: ${analysisResult.transaction_id}\n`;
          msg += `\nObrigado pelo pagamento! 💚\nNutricar Brasil - Mini Mercado 24h`;
          await sendWhatsAppMessage(supabase, ctx, msg);
        } else if (analysisResult.verdict === "suspeito") {
          let msg = "⚠️ *Comprovante requer verificação manual*\n\n";
          msg += "Identificamos algumas inconsistências no comprovante enviado. ";
          msg += "Nossa equipe irá analisar e confirmar o pagamento em breve.\n\n";
          msg += "Se preferir, envie um novo comprovante ou entre em contato com o suporte. 📞\n";
          msg += "\nNutricar Brasil - Mini Mercado 24h";
          await sendWhatsAppMessage(supabase, ctx, msg);
        } else {
          let msg = "❌ *Não foi possível validar o comprovante*\n\n";
          msg += "O comprovante enviado apresenta divergências com os dados do pagamento esperado.\n\n";
          msg += "Por favor, verifique:\n";
          msg += `• A chave PIX utilizada: *${expectedPixKey}*\n`;
          if (checkValue && expectedProductPrice) msg += `• O valor correto: *R$ ${Number(expectedProductPrice).toFixed(2)}*\n`;
          msg += "\nSe o problema persistir, entre em contato com o suporte. 📞\n";
          msg += "\nNutricar Brasil - Mini Mercado 24h";
          await sendWhatsAppMessage(supabase, ctx, msg);
        }
      }

      // Auto-tag suspicious payments
      if (autoTagFraud && (analysisResult.verdict === "suspeito" || analysisResult.verdict === "reprovado") && ctx.userId) {
        try {
          // Find or create the fraud tag
          let { data: existingTag } = await supabase
            .from("tags")
            .select("id")
            .eq("name", fraudTag)
            .eq("created_by", ctx.userId)
            .maybeSingle();

          if (!existingTag) {
            const { data: newTag } = await supabase
              .from("tags")
              .insert({ name: fraudTag, color: "#ef4444", created_by: ctx.userId })
              .select("id")
              .single();
            existingTag = newTag;
          }

          if (existingTag) {
            await supabase
              .from("contact_tags")
              .upsert({ contact_id: ctx.contactId, tag_id: existingTag.id }, { onConflict: "contact_id,tag_id" });
            console.log(`[VERIFY PAYMENT] Tagged contact ${ctx.contactId} with "${fraudTag}"`);
          }
        } catch (e) {
          console.error("[VERIFY PAYMENT] Failed to tag:", e);
        }
      }

      return {
        verified: analysisResult.verdict === "aprovado",
        verdict: analysisResult.verdict,
        fraud_score: analysisResult.fraud_score,
        amount: analysisResult.amount,
        key_matches: analysisResult.key_matches,
        recipient_matches: analysisResult.recipient_matches,
      };
    }

    // ── MULTIMODAL NODES ──

    if (type === "condition_media_type") {
      const expectedType = d.media_type || "text";
      const msgType = ctx.messageType || "text";
      // Map WhatsApp message types to our categories
      const typeMap: Record<string, string> = {
        text: "text", chat: "text",
        image: "image", sticker: "image",
        audio: "audio", ptt: "audio", voice: "audio",
        video: "video",
        document: "document", pdf: "document",
      };
      const normalizedType = typeMap[msgType] || msgType;
      return normalizedType === expectedType;
    }

    if (type === "action_collect_messages") {
      const waitSeconds = Math.max(parseInt(d.wait_seconds) || 15, 3);
      const maxMessages = parseInt(d.max_messages) || 10;
      // Wait for the specified interval (capped at 25s for edge function limit)
      const waitMs = Math.min(waitSeconds * 1000, 25000);
      console.log(`[Collect] Waiting ${waitMs}ms for batched messages (configured: ${waitSeconds}s)`);
      await new Promise((r) => setTimeout(r, waitMs));

      // Fetch recent messages from this contact during the wait window
      const cutoff = new Date(Date.now() - waitMs - 5000).toISOString(); // 5s buffer
      const { data: batchMsgs } = await supabase
        .from("messages")
        .select("content, type, media_url, created_at")
        .eq("contact_id", ctx.contactId)
        .eq("direction", "inbound")
        .gte("created_at", cutoff)
        .order("created_at", { ascending: true })
        .limit(maxMessages);

      // Also fetch the last 5 messages overall for broader context (session-scoped)
      let batchContextQuery = supabase
        .from("messages")
        .select("content, type, media_url, created_at, direction")
        .eq("contact_id", ctx.contactId)
        .eq("direction", "inbound")
        .order("created_at", { ascending: false })
        .limit(5);
      if (ctx.sessionStartedAt) batchContextQuery = batchContextQuery.gte("created_at", ctx.sessionStartedAt);
      const { data: recentContextMsgs } = await batchContextQuery;

      // Merge: use time-windowed batch if available, otherwise recent messages
      const msgsToAggregate = (batchMsgs && batchMsgs.length > 0) 
        ? batchMsgs 
        : (recentContextMsgs || []).reverse();

      // Aggregate all message contents into context
      const aggregated = msgsToAggregate
        .map((m: any) => {
          if (m.type === "text" || m.type === "chat") return m.content || "";
          if (m.type === "audio" || m.type === "ptt") return `[Áudio: ${m.media_url || "sem URL"}]`;
          if (m.type === "document") return `[Documento: ${m.media_url || "sem URL"}]`;
          if (m.type === "image") return `[Imagem enviada: ${m.media_url || "sem URL"}]`;
          return m.content || `[${m.type}]`;
        })
        .filter(Boolean)
        .join("\n");

      // Check if any collected message is an image (store URL for vision)
      const lastImageMsg = msgsToAggregate.reverse().find((m: any) => m.type === "image" && m.media_url);
      if (lastImageMsg) {
        ctx.variables["imagem_url"] = lastImageMsg.media_url;
      }

      // Update context with aggregated messages
      ctx.messageContent = aggregated || ctx.messageContent;
      ctx.variables["mensagens_agrupadas"] = aggregated;
      ctx.variables["total_mensagens"] = String(msgsToAggregate.length);
      ctx.variables["_collect_wait_seconds"] = String(waitSeconds);

      return { collected: msgsToAggregate.length, aggregated: aggregated.slice(0, 200) };
    }

    if (type === "action_transcribe_audio") {
      const provider = d.provider || "whisper";
      const language = d.language || "pt";

      // ── Determine time window: use collect node's window if available ──
      const collectWaitSeconds = parseInt(ctx.variables["_collect_wait_seconds"] || "0");
      const lookbackMs = collectWaitSeconds > 0 ? (collectWaitSeconds + 15) * 1000 : 120_000; // default 2min
      const cutoff = new Date(Date.now() - lookbackMs).toISOString();

      // Find ALL recent audio messages from contact (not just the last one)
      const { data: audioMsgs } = await supabase
        .from("messages")
        .select("media_url, type, created_at")
        .eq("contact_id", ctx.contactId)
        .eq("direction", "inbound")
        .in("type", ["audio", "ptt"])
        .gte("created_at", cutoff)
        .order("created_at", { ascending: true })
        .limit(10);

      if (!audioMsgs || audioMsgs.length === 0) {
        ctx.variables["transcricao"] = "";
        return { transcribed: false, reason: "no_audio_found" };
      }

      console.log(`[TRANSCRIBE] Found ${audioMsgs.length} audio(s) to transcribe within ${Math.round(lookbackMs/1000)}s window`);

      // ── Prepare API keys once (reused for all audios) ──
      const { data: ownerAuto } = await supabase.from("automations").select("created_by").limit(1).single();
      let openaiKey = "";
      let elevenlabsKey = "";
      if (ownerAuto?.created_by) {
        const { data: s } = await supabase.from("settings").select("value").eq("user_id", ownerAuto.created_by).eq("key", "llm_openai").single();
        openaiKey = (s?.value as any)?.apiKey || "";
        const { data: elS } = await supabase.from("settings").select("value").eq("user_id", ownerAuto.created_by).eq("key", "elevenlabs").single();
        elevenlabsKey = (elS?.value as any)?.apiKey || "";
      }
      if (!elevenlabsKey) elevenlabsKey = Deno.env.get("ELEVENLABS_API_KEY") || "";

      // ── Transcribe each audio sequentially ──
      const transcriptions: string[] = [];

      for (let i = 0; i < audioMsgs.length; i++) {
        const audioUrl = audioMsgs[i].media_url;
        if (!audioUrl) continue;

        console.log(`[TRANSCRIBE] Processing audio ${i + 1}/${audioMsgs.length}: ${audioUrl.slice(0, 60)}`);

        let audioBlob: Blob;
        let finalAudioUrl = audioUrl;

        // If the URL is an encrypted WhatsApp URL, try downloading via UazAPI first
        const isEncryptedUrl = audioUrl.includes('.enc') || audioUrl.includes('mmg.whatsapp.net');
        if (isEncryptedUrl) {
          console.log(`[TRANSCRIBE] Audio ${i + 1} is encrypted WhatsApp URL, attempting UazAPI download`);
          const redownloaded = await tryUazapiMediaDownload(supabase, ctx, audioMsgs[i], audioUrl);
          if (redownloaded) {
            finalAudioUrl = redownloaded.url;
            audioBlob = redownloaded.blob;
            console.log(`[TRANSCRIBE] Audio ${i + 1} re-downloaded via UazAPI: ${finalAudioUrl.slice(0, 60)}`);
          } else {
            // Fallback: try direct download anyway
            try {
              const audioResp = await fetch(audioUrl);
              if (!audioResp.ok) {
                console.error(`[TRANSCRIBE] Direct download also failed for audio ${i + 1} (HTTP ${audioResp.status})`);
                continue;
              }
              audioBlob = await audioResp.blob();
            } catch (e) {
              console.error(`[TRANSCRIBE] Download error for audio ${i + 1}:`, e);
              continue;
            }
          }
        } else {
          try {
            const audioResp = await fetch(finalAudioUrl);
            if (!audioResp.ok) {
              console.error(`[TRANSCRIBE] Download failed for audio ${i + 1} (HTTP ${audioResp.status})`);
              continue;
            }
            audioBlob = await audioResp.blob();
          } catch (e) {
            console.error(`[TRANSCRIBE] Download error for audio ${i + 1}:`, e);
            continue;
          }
        }

        let singleTranscription = "";

        if (provider === "elevenlabs") {
          const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
          const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
          const formData = new FormData();
          formData.append("audio", audioBlob, "audio.ogg");
          formData.append("language_code", language === "pt" ? "por" : language);
          const resp = await fetch(`${supabaseUrl}/functions/v1/elevenlabs-stt`, {
            method: "POST",
            headers: { Authorization: `Bearer ${serviceKey}` },
            body: formData,
          });
          if (resp.ok) {
            const result = await resp.json();
            singleTranscription = result.text || "";
          }
        } else {
          // Try Whisper first
          if (openaiKey) {
            const formData = new FormData();
            formData.append("file", audioBlob, "audio.ogg");
            formData.append("model", "whisper-1");
            formData.append("language", language);
            const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
              method: "POST",
              headers: { Authorization: `Bearer ${openaiKey}` },
              body: formData,
            });
            if (resp.ok) {
              const result = await resp.json();
              singleTranscription = result.text || "";
            } else {
              console.error(`[TRANSCRIBE] Whisper failed for audio ${i + 1} (${resp.status})`);
            }
          }

          // Fallback to ElevenLabs STT
          if (!singleTranscription && elevenlabsKey) {
            const elFormData = new FormData();
            elFormData.append("file", audioBlob, "audio.ogg");
            elFormData.append("model_id", "scribe_v2");
            elFormData.append("language_code", language === "pt" ? "por" : language);
            const elResp = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
              method: "POST",
              headers: { "xi-api-key": elevenlabsKey },
              body: elFormData,
            });
            if (elResp.ok) {
              const elResult = await elResp.json();
              singleTranscription = elResult.text || "";
            } else {
              const elErr = await elResp.text();
              console.error(`[TRANSCRIBE] ElevenLabs STT failed for audio ${i + 1}: ${elErr.slice(0, 100)}`);
            }
          }
        }

        if (singleTranscription) {
          transcriptions.push(singleTranscription);
          console.log(`[TRANSCRIBE] Audio ${i + 1} transcribed: "${singleTranscription.slice(0, 60)}"`);
        } else {
          console.warn(`[TRANSCRIBE] Audio ${i + 1} could not be transcribed`);
        }
      }

      // ── Combine all transcriptions and apply post-processing corrections ──
      const rawTranscription = transcriptions.join(" ");
      const fullTranscription = normalizeTranscription(rawTranscription);
      if (rawTranscription !== fullTranscription) {
        console.log(`[TRANSCRIBE] Post-processing corrections applied: "${rawTranscription.slice(0, 80)}" → "${fullTranscription.slice(0, 80)}"`);
      }

      ctx.variables["transcricao"] = fullTranscription;
      ctx.variables["total_audios_transcritos"] = String(transcriptions.length);

      // Append transcription to message content for downstream IA nodes
      if (fullTranscription) {
        ctx.messageContent += `\n\n[Transcrição de ${transcriptions.length} áudio(s)]: ${fullTranscription}`;
      }

      console.log(`[TRANSCRIBE] Completed: ${transcriptions.length}/${audioMsgs.length} audios transcribed, total ${fullTranscription.length} chars`);
      return { transcribed: transcriptions.length > 0, audioCount: audioMsgs.length, transcribedCount: transcriptions.length, transcription: fullTranscription.slice(0, 300) };
    }

    if (type === "action_extract_pdf") {
      const maxPages = parseInt(d.max_pages) || 10;

      // Find last document message
      const { data: docMsgs } = await supabase
        .from("messages")
        .select("media_url, type, content")
        .eq("contact_id", ctx.contactId)
        .eq("direction", "inbound")
        .eq("type", "document")
        .order("created_at", { ascending: false })
        .limit(1);

      const docUrl = docMsgs?.[0]?.media_url;
      if (!docUrl) {
        ctx.variables["pdf_conteudo"] = "";
        return { extracted: false, reason: "no_document_found" };
      }

      // Download document
      const docResp = await fetch(docUrl);
      if (!docResp.ok) {
        return { extracted: false, reason: "document_download_failed" };
      }

      // For PDF text extraction, we use a simple approach:
      // Extract raw text from the PDF binary (basic extraction)
      const buffer = await docResp.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const textDecoder = new TextDecoder("utf-8", { fatal: false });
      const rawText = textDecoder.decode(bytes);

      // Extract text between stream markers (basic PDF text extraction)
      const textParts: string[] = [];
      const streamRegex = /stream\s*([\s\S]*?)\s*endstream/g;
      let match;
      while ((match = streamRegex.exec(rawText)) !== null && textParts.length < maxPages * 5) {
        const content = match[1]
          .replace(/[^\x20-\x7E\xC0-\xFF\u00C0-\u024F]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (content.length > 20) textParts.push(content);
      }

      let extractedText = textParts.join("\n").slice(0, 3000); // Cap at 3000 chars

      // If summarize is enabled and we have text, use AI to summarize
      if (d.summarize && extractedText) {
        const { keys: pdfKeys } = await getUserAIKeys(supabase, ctx.userId);
        if (pdfKeys.openai || pdfKeys.gemini) {
          const summaryPrompt = `Resuma o conteúdo do documento de forma clara e objetiva em português. Máximo 500 palavras.\n\n${extractedText}`;
          const summary = await callAIWithUserKeys(pdfKeys, summaryPrompt, { maxTokens: 600, temperature: 0.3 });
          if (summary) extractedText = summary;
        }
      }

      ctx.variables["pdf_conteudo"] = extractedText;
      if (extractedText) {
        ctx.messageContent += `\n\n[Conteúdo do documento]: ${extractedText}`;
      }
      return { extracted: !!extractedText, textLength: extractedText.length };
    }

    console.log(`Unknown node type: ${type}`);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    console.error(`Error executing node ${type} (${node.id}):`, err);
    throw new Error(message);
  }
}

// ── Auto-send PIX key ONLY when customer EXPLICITLY requests to pay via PIX ──
// Matches EXPLICIT PIX payment requests, NOT difficulty reports or general payment mentions
const PIX_EXPLICIT_REQUEST = /\b(me\s*envi[ae]\s*(a\s*)?chave|manda\s*(a\s*)?chave|quero\s*pagar\s*(via\s*)?pix|pode\s*enviar\s*(a\s*)?chave|qual\s*(a\s*)?chave\s*pix|chave\s*pix\s*por\s*favor|vou\s*pagar\s*(via\s*)?pix|quero\s*fazer\s*(o\s*)?pix|como\s*fa[cç]o\s*(o\s*)?pix|quer\s*pagar\s*por\s*pix)\b/i;
// Matches SHORT confirmations like "pode enviar", "sim", "quero", "manda" — only valid when product already identified
// Also matches interactive button responses like "Enviar chave PIX" or "pix_enviar"
const PIX_CONFIRMATION = /^(pode\s*(enviar|mandar)|sim|quero|manda|envia|pode\s*sim|bora|vamos|isso|ok|blz|beleza|fechou|fecho|pode\s*ser|por\s*favor|pfv|pfvr|claro|com\s*certeza|pode|manda\s*a[ií]|envia\s*a[ií]|pode\s*ser\s*sim|quero\s*sim|sim\s*quero|sim\s*pode|pode\s*s[ií]|manda\s*pra\s*mim|pix_enviar|enviar\s*chave\s*pix|✅\s*enviar\s*chave\s*pix)[\s!.]*$/i;
// Matches problems/failures with payment — used to INVESTIGATE, not to send PIX immediately
// IMPORTANT: use "pag" (not "pagar") to also match "pagamento", "pago", etc.
// Use "consig" AND "conseg" variants to cover "consigo" and "consegui/consegue"
const PIX_DIFFICULTY_KEYWORDS = /(n[aã]o.*consig[ou].*pag|n[aã]o.*conseg.*pag|n[aã]o.*consigo.*fazer.*pag|n[aã]o.*consegui.*pag|n[aã]o.*passou|n[aã]o.*aceito[ua]?|n[aã]o.*aceita|n[aã]o.*funciono[ua]|problema.*pag|erro.*pag|erro.*totem|pag.*erro|pag.*n[aã]o.*foi|cobran[cç]a.*indevid|valor.*cobrado.*errado|cobrou.*errado|cobrou.*mais|cobrou.*a\s*mais|cobrou.*diferente|estorno|reembolso|devolu[cç][aã]o|totem.*n[aã]o|totem.*com.*defeito|totem.*erro|totem.*travou|totem.*desligad|c[ao]r[tl]?[aã]o.*recus|c[ao]r[tl]?[aã]o.*n[aã]o|c[ao]r[tl]?[aã]o.*dando|c[ao]r[tl]?[aã]o.*erro|c[ao]r[tl]?[aã]o.*revis|dando.*recus|dando.*erro|dando.*revis|pix.*n[aã]o.*funciono|pix.*erro|pix.*problema|dificuldade.*pag|n[aã]o.*conseg.*pix|n[aã]o.*consig.*pix|n[aã]o.*conseg.*fazer.*pag|n[aã]o.*estou.*conseguindo|n[aã]o.*t[aá].*conseguindo|n[aã]o.*consigo.*pix)/i;
const PIX_KEY_MESSAGE = `💳 *Segue as opções de pagamento via PIX da Nutricar Brasil:*\n\n📧 *Chave PIX:* financeiro@nutricarbrasil.com.br\n\nApós o pagamento, envie o comprovante aqui pra gente confirmar! 😊\n_Nutricar Brasil - Mini Mercado 24h_`;

function buildPixPaymentMessage(productName?: string, productPrice?: string | number, quantity?: number): string {
  const safeName = String(productName || "").trim();
  const numericPrice = Number(productPrice);
  const qty = Math.max(1, quantity || 1);
  const hasProduct = !!safeName;
  const hasPrice = Number.isFinite(numericPrice) && numericPrice > 0;

  if (hasProduct && hasPrice) {
    const unitFormatted = numericPrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const total = numericPrice * qty;
    const totalFormatted = total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    
    let msg = `🛒 *Produto:* ${safeName}\n💰 *Valor unitário:* ${unitFormatted}`;
    if (qty > 1) {
      msg += `\n📦 *Quantidade:* ${qty} unidade(s)\n🧾 *Total: ${totalFormatted}*`;
    }
    msg += `\n\n${PIX_KEY_MESSAGE}`;
    return msg;
  }

  return PIX_KEY_MESSAGE;
}

// ── Helper: Recover shopping cart items from recent outbound messages ──
// Handles corrections (uses LATEST qty for duplicate product names) and removals (🗑️ markers)
async function recoverCartFromMessages(supabase: any, ctx: ExecutionContext): Promise<Array<{ name: string; price: number; qty: number }>> {
  const cartMap = new Map<string, { name: string; price: number; qty: number }>();
  const removedItems = new Set<string>();

  try {
    let cartQuery = supabase
      .from("messages")
      .select("content")
      .eq("contact_id", ctx.contactId)
      .eq("direction", "outbound")
      .order("created_at", { ascending: true }) // oldest first so latest overwrites
      .limit(50);
    if (ctx.sessionStartedAt) cartQuery = cartQuery.gte("created_at", ctx.sessionStartedAt);
    const { data: msgs } = await cartQuery;

    // Pattern matches: "✅ Adicionado!\n\n🛒 *PRODUCT*\n💰 Unitário: *R$ X,XX*\n📦 Quantidade: *N*"
    const cartItemPattern = /🛒\s*\*([^*]+)\*\s*\n💰\s*Unitário:\s*\*R\$\s*([\d.,]+)\*\s*\n📦\s*Quantidade:\s*\*(\d+)\*/g;
    // Removal pattern: "🗑️ Removido do carrinho: *PRODUCT*"
    const removePattern = /🗑️\s*Removido do carrinho:\s*\*([^*]+)\*/;
    
    for (const m of (msgs || [])) {
      const content = m.content || "";
      
      // Check for removal markers
      const removeMatch = content.match(removePattern);
      if (removeMatch) {
        const removedName = removeMatch[1].trim().toLowerCase();
        removedItems.add(removedName);
        cartMap.delete(removedName);
        continue;
      }
      
      // Check for cart items (latest entry wins for corrections)
      let match;
      while ((match = cartItemPattern.exec(content)) !== null) {
        const name = match[1].trim();
        const nameLower = name.toLowerCase();
        const price = parseFloat(match[2].replace(".", "").replace(",", "."));
        const qty = parseInt(match[3]) || 1;
        if (price > 0 && !removedItems.has(nameLower)) {
          cartMap.set(nameLower, { name, price, qty });
        }
      }
      cartItemPattern.lastIndex = 0;
    }
  } catch (e) {
    console.error("[CART] Error recovering cart:", e);
  }

  const cart = Array.from(cartMap.values());
  console.log(`[CART] Recovered ${cart.length} items from messages (${removedItems.size} removed)`);
  return cart;
}

// ── Helper: Send interactive buttons via WhatsApp (UazAPI /send/menu) ──
async function sendInteractiveButtons(
  supabase: any,
  ctx: ExecutionContext,
  bodyText: string,
  buttons: Array<{ label: string; id: string }>,
  footer?: string
): Promise<boolean> {
  try {
    const instance = await getCachedInstance(supabase, ctx.userId, ctx.instanceId);
    if (!instance) return false;

    const cleanNumber = String(ctx.contactPhone || "").replace(/\D/g, "");
    const baseUrl = String(instance.base_url).replace(/\/+$/, "");

    const choices = buttons.map(b => `${b.label}|${b.id}`);

    const payload: Record<string, any> = {
      number: cleanNumber,
      text: bodyText,
      choices,
      type: "button",
    };
    if (footer) payload.footerText = footer;

    const resp = await fetch(`${baseUrl}/send/menu`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        token: instance.instance_token,
      },
      body: JSON.stringify(payload),
    });

    const rawResponse = await resp.text();
    console.log(`[Interactive Buttons] Sent to ${cleanNumber}: ${resp.status} — ${rawResponse.slice(0, 200)}`);
    
    // Save to messages table
    const normalizeMsgId = (value: unknown): string | null => {
      if (!value) return null;
      const raw = String(value).trim();
      if (!raw) return null;
      const parts = raw.split(":").filter(Boolean);
      return parts.length > 1 ? parts[parts.length - 1] : raw;
    };
    let result: any = {};
    try { result = rawResponse ? JSON.parse(rawResponse) : {}; } catch {}
    const externalId = normalizeMsgId(result?.messageid || result?.messageId || result?.key?.id || result?.message?.key?.id || result?.data?.key?.id || null);
    
    await supabase.from("messages").insert({
      contact_id: ctx.contactId,
      direction: "outbound",
      type: "interactive",
      content: bodyText,
      external_id: externalId,
      user_id: ctx.userId,
      metadata: { buttons: buttons.map(b => b.label), footer, source: "automation" },
    });

    return resp.ok;
  } catch (e) {
    console.error("[Interactive Buttons] Error:", e);
    return false;
  }
}

async function sendPixKeyIfPaymentRelated(supabase: any, ctx: ExecutionContext): Promise<boolean> {
  // Check if PIX was already sent or buttons already offered in this execution
  if (ctx.variables["_pix_key_sent"] === "true") return false;
  if (ctx.variables["_pix_buttons_sent"] === "true") {
    console.log(`[PIX] Skipping sendPixKeyIfPaymentRelated — PIX buttons already sent this execution`);
    return false;
  }
  // Check if difficulty was detected earlier in the flow — never auto-send PIX during problem reports
  if (ctx.variables["_difficulty_detected"] === "true") {
    console.log(`[PIX] Skipping sendPixKeyIfPaymentRelated — _difficulty_detected flag is set`);
    return false;
  }

  // ── QUANTITY RESPONSE HANDLER: Customer replied with quantity after product was identified ──
  // Check if we recently asked "Quantas unidades" in outbound messages
  const msgTrimmed = (ctx.messageContent || "").trim();
  const qtyMatch = msgTrimmed.match(/^[\s]*(\d{1,2})[\s]*$/); // Strict: just a number
  const qtyMatchLoose = msgTrimmed.match(/(\d{1,2})\s*(?:unidade|produto|peguei|são|sao)?/i);
  const potentialQty = qtyMatch || qtyMatchLoose;
  
  // ── CART "VIEW/EDIT" HANDLER: Customer clicked "ver_carrinho" or typed "carrinho", "ver carrinho", "editar" ──
  const isViewCart = /^(ver.?carrinho|carrinho|editar|ver_carrinho)/i.test(msgTrimmed) || msgTrimmed === "ver_carrinho";
  if (isViewCart) {
    const cart = await recoverCartFromMessages(supabase, ctx);
    if (cart.length > 0) {
      let grandTotal = 0;
      let cartSummary = "🛒 *Seu carrinho atual:*\n\n";
      for (let i = 0; i < cart.length; i++) {
        const item = cart[i];
        const itemTotal = item.price * item.qty;
        grandTotal += itemTotal;
        const unitStr = item.price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        const totalStr = itemTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        cartSummary += `${i + 1}️⃣ *${item.name}* — ${unitStr} x ${item.qty} = *${totalStr}*\n`;
      }
      const grandTotalStr = grandTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      cartSummary += `\n🧾 *Total: ${grandTotalStr}*\n\n✏️ Para *corrigir quantidade*, digite:\n_corrigir Nome do Produto para 3_\n\n🗑️ Para *remover item*, digite:\n_remover Nome do Produto_`;
      
      ctx.variables["_awaiting_more_products"] = "true";
      const buttonsSent = await sendInteractiveButtons(
        supabase, ctx, cartSummary,
        [
          { label: "✅ Sim, mais produto", id: "mais_produto" },
          { label: "❌ Não, finalizar", id: "finalizar_compra" },
        ],
        "Nutricar Brasil - Mini Mercado 24h"
      );
      if (!buttonsSent) {
        await sendWhatsAppMessage(supabase, ctx, cartSummary);
      }
      console.log(`[CART] Showing cart: ${cart.length} items, total=${grandTotalStr}`);
      return true;
    } else {
      await sendWhatsAppMessage(supabase, ctx, "🛒 Seu carrinho está vazio! Envie uma 📸 *foto do código de barras* do produto para começar. 🔍\n\n_Nutricar Brasil - Mini Mercado 24h_ 💚");
      return true;
    }
  }

  // ── CART "REMOVE ITEM" HANDLER: Customer typed "remover X" or "tirar X" ──
  const removeMatch = msgTrimmed.match(/^(?:remover|tirar|excluir|deletar|retirar)\s+(.+)/i);
  if (removeMatch) {
    const itemToRemove = removeMatch[1].trim().toLowerCase().replace(/^\*|\*$/g, "");
    const cart = await recoverCartFromMessages(supabase, ctx);
    const foundItem = cart.find(item => item.name.toLowerCase().includes(itemToRemove));
    
    if (foundItem) {
      // We can't actually delete messages, so we'll send a "removal" marker message
      // and update recoverCartFromMessages to exclude removed items
      const removeMarker = `🗑️ Removido do carrinho: *${foundItem.name}*`;
      await sendWhatsAppMessage(supabase, ctx, removeMarker);
      
      // Rebuild cart without the removed item
      const updatedCart = cart.filter(item => item.name !== foundItem.name);
      
      if (updatedCart.length > 0) {
        let grandTotal = 0;
        let cartSummary = "🛒 *Carrinho atualizado:*\n\n";
        for (const item of updatedCart) {
          const itemTotal = item.price * item.qty;
          grandTotal += itemTotal;
          const unitStr = item.price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
          const totalStr = itemTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
          cartSummary += `• *${item.name}* — ${unitStr} x ${item.qty} = *${totalStr}*\n`;
        }
        const grandTotalStr = grandTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        cartSummary += `\n🧾 *Total: ${grandTotalStr}*\n\n🛍️ *Pegou mais algum produto?*`;
        
        ctx.variables["_awaiting_more_products"] = "true";
        const buttonsSent = await sendInteractiveButtons(
          supabase, ctx, cartSummary,
          [
            { label: "✅ Sim, mais produto", id: "mais_produto" },
            { label: "❌ Não, finalizar", id: "finalizar_compra" },
            { label: "📋 Ver carrinho", id: "ver_carrinho" },
          ],
          "Nutricar Brasil - Mini Mercado 24h"
        );
        if (!buttonsSent) {
          await sendWhatsAppMessage(supabase, ctx, cartSummary);
        }
      } else {
        await sendWhatsAppMessage(supabase, ctx, "🛒 Seu carrinho ficou vazio! Envie uma 📸 *foto do código de barras* do produto para começar novamente. 🔍\n\n_Nutricar Brasil - Mini Mercado 24h_ 💚");
        ctx.variables["_awaiting_more_products"] = "false";
      }
      console.log(`[CART] Removed item: ${foundItem.name}`);
      return true;
    } else {
      await sendWhatsAppMessage(supabase, ctx, `❌ Não encontrei "*${removeMatch[1].trim()}*" no carrinho. Digite *carrinho* para ver seus itens.\n\n_Nutricar Brasil - Mini Mercado 24h_ 💚`);
      return true;
    }
  }

  // ── CART "CORRECT QUANTITY" HANDLER: Customer typed "corrigir X para Y" ──
  const correctMatch = msgTrimmed.match(/^(?:corrigir|alterar|mudar|trocar)\s+(.+?)\s+(?:para|pra|p\/)\s*(\d{1,2})/i);
  if (correctMatch) {
    const itemToCorrect = correctMatch[1].trim().toLowerCase().replace(/^\*|\*$/g, "");
    const newQty = Math.max(1, Math.min(50, parseInt(correctMatch[2]) || 1));
    const cart = await recoverCartFromMessages(supabase, ctx);
    const foundItem = cart.find(item => item.name.toLowerCase().includes(itemToCorrect));
    
    if (foundItem) {
      const newTotal = foundItem.price * newQty;
      const unitStr = foundItem.price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      const newTotalStr = newTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      
      // Send correction marker message (recoverCartFromMessages will pick up the latest qty)
      const correctionMsg = `✏️ Quantidade corrigida!\n\n🛒 *${foundItem.name}*\n💰 Unitário: *${unitStr}*\n📦 Quantidade: *${newQty}*\n🧾 Subtotal: *${newTotalStr}*`;
      
      // Send as "✅ Adicionado!" format so recoverCartFromMessages picks it up and overwrites the old one
      const correctionMarkerMsg = `✅ Adicionado!\n\n🛒 *${foundItem.name}*\n💰 Unitário: *${unitStr}*\n📦 Quantidade: *${newQty}*\n🧾 Subtotal: *${newTotalStr}*\n\n✏️ _Quantidade atualizada de ${foundItem.qty} → ${newQty}_`;
      await sendWhatsAppMessage(supabase, ctx, correctionMarkerMsg);
      
      // Rebuild cart with updated quantity for this item
      const updatedCart = cart.map(item => 
        item.name === foundItem.name ? { ...item, qty: newQty } : item
      );
      
      let grandTotal = 0;
      let cartSummary = "🛒 *Carrinho atualizado:*\n\n";
      for (const item of updatedCart) {
        const itemTotal = item.price * item.qty;
        grandTotal += itemTotal;
        const uStr = item.price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        const tStr = itemTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        cartSummary += `• *${item.name}* — ${uStr} x ${item.qty} = *${tStr}*\n`;
      }
      const grandTotalStr = grandTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      cartSummary += `\n🧾 *Total: ${grandTotalStr}*\n\n🛍️ *Pegou mais algum produto?*`;
      
      ctx.variables["_awaiting_more_products"] = "true";
      const buttonsSent = await sendInteractiveButtons(
        supabase, ctx, cartSummary,
        [
          { label: "✅ Sim, mais produto", id: "mais_produto" },
          { label: "❌ Não, finalizar", id: "finalizar_compra" },
          { label: "📋 Ver carrinho", id: "ver_carrinho" },
        ],
        "Nutricar Brasil - Mini Mercado 24h"
      );
      if (!buttonsSent) {
        await sendWhatsAppMessage(supabase, ctx, cartSummary);
      }
      console.log(`[CART] Corrected qty: ${foundItem.name} ${foundItem.qty} → ${newQty}`);
      return true;
    } else {
      await sendWhatsAppMessage(supabase, ctx, `❌ Não encontrei "*${correctMatch[1].trim()}*" no carrinho. Digite *carrinho* para ver seus itens.\n\n_Nutricar Brasil - Mini Mercado 24h_ 💚`);
      return true;
    }
  }

  // ── CART "MORE PRODUCTS?" HANDLER: Customer replied "sim" or clicked "mais_produto" ──
  const isMoreProducts = /^(sim|s|quero|tenho|peguei|tem mais|mais produto)/i.test(msgTrimmed);
  const isButtonMoreProducts = msgTrimmed === "mais_produto";
  const awaitingMoreProducts = ctx.variables["_awaiting_more_products"] === "true";
  
  // Check recent outbound for "mais algum produto" prompt
  let recentlyAskedMoreProducts = awaitingMoreProducts;
  if (!recentlyAskedMoreProducts && (isMoreProducts || isButtonMoreProducts)) {
    try {
      let moreCheckQuery = supabase
        .from("messages")
        .select("content, metadata")
        .eq("contact_id", ctx.contactId)
        .eq("direction", "outbound")
        .order("created_at", { ascending: false })
        .limit(5);
      if (ctx.sessionStartedAt) moreCheckQuery = moreCheckQuery.gte("created_at", ctx.sessionStartedAt);
      const { data: recentOut } = await moreCheckQuery;
      recentlyAskedMoreProducts = (recentOut || []).some((m: any) => 
        /mais algum produto|pegou mais/i.test(m.content || "") ||
        (m.metadata?.buttons && JSON.stringify(m.metadata.buttons).includes("mais_produto"))
      );
    } catch {}
  }

  if ((isMoreProducts || isButtonMoreProducts) && recentlyAskedMoreProducts) {
    ctx.variables["_awaiting_more_products"] = "false";
    const nextProductMsg = `📸 Envie uma *foto do código de barras* do próximo produto para eu consultar o valor! 🔍\n\n_Nutricar Brasil - Mini Mercado 24h_ 💚`;
    await sendWhatsAppMessage(supabase, ctx, nextProductMsg);
    console.log(`[CART] Customer wants more products — asking for next barcode`);
    return true;
  }

  // ── CART "FINALIZE" HANDLER: Customer replied "não" or clicked "finalizar_compra" ──
  const isFinalize = /^(n[aã]o|nao|n|finalizar|só isso|so isso|é só|e so|pronto|acabou|terminei)/i.test(msgTrimmed);
  const isButtonFinalize = msgTrimmed === "finalizar_compra";
  
  let recentlyAskedFinalizeCheck = awaitingMoreProducts;
  if (!recentlyAskedFinalizeCheck && (isFinalize || isButtonFinalize)) {
    try {
      let finalCheckQuery = supabase
        .from("messages")
        .select("content, metadata")
        .eq("contact_id", ctx.contactId)
        .eq("direction", "outbound")
        .order("created_at", { ascending: false })
        .limit(5);
      if (ctx.sessionStartedAt) finalCheckQuery = finalCheckQuery.gte("created_at", ctx.sessionStartedAt);
      const { data: recentOut } = await finalCheckQuery;
      recentlyAskedFinalizeCheck = (recentOut || []).some((m: any) => 
        /mais algum produto|pegou mais/i.test(m.content || "") ||
        (m.metadata?.buttons && JSON.stringify(m.metadata.buttons).includes("finalizar_compra"))
      );
    } catch {}
  }

  if ((isFinalize || isButtonFinalize) && recentlyAskedFinalizeCheck) {
    ctx.variables["_awaiting_more_products"] = "false";
    // Load cart from recent messages
    const cart = await recoverCartFromMessages(supabase, ctx);
    
    if (cart.length > 0) {
      let grandTotal = 0;
      let cartSummary = "🛒 *Resumo da sua compra:*\n\n";
      for (const item of cart) {
        const itemTotal = item.price * item.qty;
        grandTotal += itemTotal;
        const unitStr = item.price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        const totalStr = itemTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        cartSummary += `• *${item.name}* — ${unitStr} x ${item.qty} = *${totalStr}*\n`;
      }
      const grandTotalStr = grandTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      cartSummary += `\n🧾 *Total geral: ${grandTotalStr}*`;
      
      ctx.variables["produto_total"] = String(grandTotal);
      ctx.variables["_carrinho_itens"] = String(cart.length);
      
      const buttonsSent = await sendInteractiveButtons(
        supabase, ctx, cartSummary,
        [
          { label: "✅ Enviar chave PIX", id: "pix_enviar" },
          { label: "❌ Cancelar", id: "pix_cancelar" },
        ],
        "Nutricar Brasil - Mini Mercado 24h"
      );
      ctx.variables["_pix_buttons_sent"] = "true";
      if (!buttonsSent) {
        await sendWhatsAppMessage(supabase, ctx, `${cartSummary}\n\nDeseja receber a chave PIX para pagamento? 😊`);
      }
      console.log(`[CART] Finalized: ${cart.length} items, total=${grandTotalStr} — showing PIX buttons`);
      return true;
    }
  }

  if (potentialQty) {
    // Check if we recently asked for quantity
    let recentlyAskedQty = ctx.variables["_awaiting_quantity"] === "true";
    
    if (!recentlyAskedQty) {
      try {
        let qtyCheckQuery = supabase
          .from("messages")
          .select("content")
          .eq("contact_id", ctx.contactId)
          .eq("direction", "outbound")
          .order("created_at", { ascending: false })
          .limit(3);
        if (ctx.sessionStartedAt) qtyCheckQuery = qtyCheckQuery.gte("created_at", ctx.sessionStartedAt);
        const { data: recentOut } = await qtyCheckQuery;
        recentlyAskedQty = (recentOut || []).some((m: any) => 
          /quantas\s*unidades/i.test(m.content || "")
        );
      } catch {}
    }

    if (recentlyAskedQty) {
      // Recover product info from recent outbound if not in current variables
      let prodName = ctx.variables["produto_nome"] || "";
      let unitPrice = Number(ctx.variables["produto_preco"] || 0);
      
      if (!prodName || !unitPrice) {
        try {
          let recoverQuery = supabase
            .from("messages")
            .select("content")
            .eq("contact_id", ctx.contactId)
            .eq("direction", "outbound")
            .order("created_at", { ascending: false })
            .limit(5);
          if (ctx.sessionStartedAt) recoverQuery = recoverQuery.gte("created_at", ctx.sessionStartedAt);
          const { data: recentMsgs } = await recoverQuery;
          for (const m of (recentMsgs || [])) {
            const match = (m.content || "").match(/Encontrei no catálogo:\s*\*([^*]+)\*[\s\S]*?Valor unitário:\s*\*R\$\s*([\d.,]+)\*/);
            if (match) {
              prodName = match[1].trim();
              unitPrice = parseFloat(match[2].replace(".", "").replace(",", "."));
              ctx.variables["produto_encontrado"] = "true";
              ctx.variables["produto_nome"] = prodName;
              ctx.variables["produto_preco"] = String(unitPrice);
              break;
            }
          }
        } catch {}
      }

      if (prodName && unitPrice > 0) {
        const quantity = Math.max(1, Math.min(50, parseInt(potentialQty[1]) || 1));
        const itemTotal = unitPrice * quantity;
        const unitPriceStr = unitPrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        const itemTotalStr = itemTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

        ctx.variables["produto_quantidade"] = String(quantity);
        ctx.variables["produto_total"] = String(itemTotal);
        ctx.variables["_awaiting_quantity"] = "false";
        ctx.variables["_awaiting_more_products"] = "true";

        // Show item confirmation + ask if there are more products
        let confirmMsg = `✅ Adicionado!\n\n🛒 *${prodName}*\n💰 Unitário: *${unitPriceStr}*\n📦 Quantidade: *${quantity}*\n🧾 Subtotal: *${itemTotalStr}*\n\n🛍️ *Pegou mais algum produto?*`;
        
        const buttonsSent = await sendInteractiveButtons(
          supabase, ctx, confirmMsg,
          [
            { label: "✅ Sim, mais produto", id: "mais_produto" },
            { label: "❌ Não, finalizar", id: "finalizar_compra" },
            { label: "📋 Ver carrinho", id: "ver_carrinho" },
          ],
          "Nutricar Brasil - Mini Mercado 24h"
        );
        if (!buttonsSent) {
          await sendWhatsAppMessage(supabase, ctx, `${confirmMsg}\n\nResponda *sim* para adicionar outro produto ou *não* para finalizar.`);
        }
        console.log(`[CART] Item added: ${prodName} x${quantity} = ${itemTotalStr} — asking if more products`);
        return true;
      }
    }
  }

  // ── GUARD: If customer says they ALREADY PAID, don't resend PIX — ask for receipt ──
  const alreadyPaidPattern = /j[aá]\s*(fiz|paguei|pago|transferi|enviei)|fiz\s*o\s*pi[x]|fiz\s*o\s*pagamento|t[aá]\s*pago|realizei\s*o\s*pagamento|fiz\s*a\s*transfer[eê]ncia/i;
  if (alreadyPaidPattern.test(ctx.messageContent)) {
    console.log(`[PIX] Customer says already paid ("${ctx.messageContent}") — NOT sending PIX key, asking for receipt`);
    const receiptMsg = "Ótimo! 😊 Para confirmar seu pagamento, por favor envie o comprovante do PIX aqui. Assim que recebermos, vamos validar rapidinho! 💚\n\n_Nutricar Brasil - Mini Mercado 24h_";
    await sendWhatsAppMessage(supabase, ctx, receiptMsg);
    ctx.variables["_audit_reply_suppressed"] = `PIX NOT resent — customer said already paid: "${ctx.messageContent}"`;
    return true;
  }

  // Check CUSTOMER context only (never use internal AI output to trigger PIX)
  const customerContext = [
    ctx.messageContent,
    ctx.variables["mensagens_agrupadas"] || "",
    ctx.variables["transcricao"] || "",
  ].join(" ");

  // ── NEW: Check if this is a SHORT CONFIRMATION (e.g. "pode enviar", "sim", "quero") ──
  // Only treat as PIX confirmation if product was already identified in a previous interaction
  const isConfirmation = PIX_CONFIRMATION.test((ctx.messageContent || "").trim());
  const productAlreadyIdentified = ctx.variables["produto_encontrado"] === "true";
  
  // Check if we recently offered PIX (check outbound messages for PIX offer)
  let recentPixOffer = false;
  if (isConfirmation && productAlreadyIdentified) {
    try {
      let pixOfferQuery = supabase
        .from("messages")
        .select("content")
        .eq("contact_id", ctx.contactId)
        .eq("direction", "outbound")
        .order("created_at", { ascending: false })
        .limit(5);
      if (ctx.sessionStartedAt) pixOfferQuery = pixOfferQuery.gte("created_at", ctx.sessionStartedAt);
      const { data: recentOutbound } = await pixOfferQuery;
      recentPixOffer = (recentOutbound || []).some((m: any) => 
        /pix|chave|pagamento via/i.test(m.content || "")
      );
    } catch {}
  }

  if (isConfirmation && productAlreadyIdentified && recentPixOffer) {
    console.log(`[PIX] Confirmation detected ("${ctx.messageContent}") + product already identified — auto-sending PIX key`);
    ctx.variables["_pix_key_sent"] = "true";
    const pixMessage = buildPixPaymentMessage(ctx.variables["produto_nome"], ctx.variables["produto_preco"], parseInt(ctx.variables["produto_quantidade"]) || 1);
    ctx.variables["_audit_pix_auto_sent"] = `PIX enviado via confirmação curta ("${ctx.messageContent}"): produto=${ctx.variables["produto_nome"] || "N/A"}, valor=${ctx.variables["produto_preco"] || "N/A"}`;
    console.log(`[AUDIT] PIX key auto-sent (confirmation) at ${new Date().toISOString()} — ${ctx.contactPhone}`);
    await sendWhatsAppMessage(supabase, ctx, pixMessage);
    return true;
  }

  // ── EXPLICIT PIX REQUEST (e.g. "me envia a chave pix") ──
  const isExplicitPixRequest = PIX_EXPLICIT_REQUEST.test(customerContext);
  const isDifficultyReport = PIX_DIFFICULTY_KEYWORDS.test(customerContext);

  // If it's a difficulty report (NOT an explicit PIX request), do NOT send PIX
  if (isDifficultyReport && !isExplicitPixRequest) {
    console.log(`[PIX] Payment DIFFICULTY detected but NO explicit PIX request — letting IA qualify first`);
    return false;
  }

  // ── UNIVERSAL RULE: PIX is ONLY sent via interactive buttons after product/value confirmation ──
  const productIdentified = ctx.variables["produto_encontrado"] === "true";
  const pixButtonsAlreadySent = ctx.variables["_pix_buttons_sent"] === "true";

  // ── CHECK: Did the customer mention a specific value? (e.g. "preciso pagar R$ 15", "o valor é 12,50") ──
  const valuePattern = /(?:R\$\s*|valor\s*(?:é|de|:)?\s*(?:R\$\s*)?|pagar\s*(?:R\$\s*)?|total\s*(?:é|de|:)?\s*(?:R\$\s*)?)([\d]+[.,][\d]{2}|[\d]+)/i;
  const valueMatch = customerContext.match(valuePattern);
  const customerStatedValue = valueMatch ? parseFloat(valueMatch[1].replace(",", ".")) : null;
  const hasCustomerValue = customerStatedValue !== null && Number.isFinite(customerStatedValue) && customerStatedValue > 0;

  if (!productIdentified && !hasCustomerValue) {
    // No product confirmed and no value stated — ask for barcode
    if (isExplicitPixRequest) {
      console.log(`[PIX] Explicit PIX request but no product/value — asking for barcode`);
      const barcodeMsg = `Para enviar a chave PIX, preciso primeiro confirmar o produto e valor. 📸\n\nPor favor, envie uma *foto do código de barras* do produto que você pegou para eu consultar o valor no sistema! 😊\n\nSe você já sabe o valor total, pode me informar também. 💬\n\n_Nutricar Brasil - Mini Mercado 24h_`;
      await sendWhatsAppMessage(supabase, ctx, barcodeMsg);
      return true;
    }
    return false;
  }

  // ── Send interactive buttons with confirmed value ──
  if (!pixButtonsAlreadySent) {
    let offerMsg = "";

    if (productIdentified) {
      // Product found in catalog — use catalog values
      const prodName = ctx.variables["produto_nome"] || "";
      const prodPriceRaw = Number(ctx.variables["produto_preco"]);
      if (prodName && Number.isFinite(prodPriceRaw) && prodPriceRaw > 0) {
        const prodPriceFormatted = prodPriceRaw.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        offerMsg = `🛒 Produto: *${prodName}*\n💰 Valor: *${prodPriceFormatted}*\n\nDeseja receber a chave PIX para pagamento? 😊`;
        console.log(`[PIX] Product confirmed (${prodName} = ${prodPriceFormatted}) — sending interactive PIX buttons`);
      }
    } else if (hasCustomerValue) {
      // Customer stated the value directly — use their value
      const valueFmt = customerStatedValue!.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      offerMsg = `💰 Valor informado: *${valueFmt}*\n\nDeseja receber a chave PIX para pagamento desse valor? 😊`;
      console.log(`[PIX] Customer stated value (${valueFmt}) — sending interactive PIX buttons`);
    }

    if (offerMsg) {
      const sent = await sendInteractiveButtons(supabase, ctx, offerMsg, [
        { label: "✅ Enviar chave PIX", id: "pix_enviar" },
        { label: "❌ Não, obrigado", id: "pix_cancelar" },
      ], "Nutricar Brasil - Mini Mercado 24h");
      
      ctx.variables["_pix_buttons_sent"] = "true";
      return sent;
    }
  }

  return false;
}

// ── Helpers ──────────────────────────────────────────────────

// ── Post-processing: fix common STT misinterpretations ──
function normalizeTranscription(text: string): string {
  if (!text) return text;
  let result = text;

  // Known STT misinterpretations map (case-insensitive replacements)
  const corrections: Array<[RegExp, string]> = [
    // "Alphaville Indaial" → "Alpha 10" / "Alphaville 10"
    [/alphaville\s+indaial/gi, "Alphaville 10"],
    [/alpha\s*ville?\s+indaial/gi, "Alphaville 10"],
    [/alfa\s*v[iy]le?\s+indaial/gi, "Alphaville 10"],
    // "alpha dez" → "Alpha 10"
    [/alpha\s+dez\b/gi, "Alpha 10"],
    [/alfa\s+dez\b/gi, "Alpha 10"],
    // Common number misheard as words
    [/\bum\s+zero\b/gi, "10"],
    [/\bdois\s+zero\b/gi, "20"],
    // Nutricar specific store name corrections
    [/\bnutri\s*car\b/gi, "Nutricar"],
  ];

  for (const [pattern, replacement] of corrections) {
    result = result.replace(pattern, replacement);
  }

  return result;
}

// ── Full Portuguese Text Normalization for TTS ──

const UNITS_TTS = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
const TEENS_TTS = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const TENS_TTS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const HUNDREDS_TTS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function numberToWordsFull(n: number): string {
  if (n === 0) return 'zero';
  if (n === 100) return 'cem';
  if (n < 0) return 'menos ' + numberToWordsFull(-n);
  const parts: string[] = [];
  if (n >= 1000000) {
    const millions = Math.floor(n / 1000000);
    parts.push(millions === 1 ? 'um milhão' : numberToWordsFull(millions) + ' milhões');
    n %= 1000000;
    if (n > 0) parts.push(n < 100 ? 'e' : '');
  }
  if (n >= 1000) {
    const thousands = Math.floor(n / 1000);
    parts.push(thousands === 1 ? 'mil' : numberToWordsFull(thousands) + ' mil');
    n %= 1000;
    if (n > 0) parts.push(n < 100 ? 'e' : '');
  }
  if (n >= 100) {
    if (n === 100) { parts.push('cem'); return parts.join(' '); }
    parts.push(HUNDREDS_TTS[Math.floor(n / 100)]);
    n %= 100;
    if (n > 0) parts.push('e');
  }
  if (n >= 20) {
    parts.push(TENS_TTS[Math.floor(n / 10)]);
    n %= 10;
    if (n > 0) parts.push('e ' + UNITS_TTS[n]);
  } else if (n >= 10) {
    parts.push(TEENS_TTS[n - 10]);
  } else if (n > 0) {
    parts.push(UNITS_TTS[n]);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function normalizeCurrencyTTS(text: string): string {
  return text.replace(/R\$\s?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)/g, (_m, value) => {
    const cleaned = value.replace(/\./g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    const reais = Math.floor(num);
    const centavos = Math.round((num - reais) * 100);
    let result = '';
    if (reais > 0) result += numberToWordsFull(reais) + (reais === 1 ? ' real' : ' reais');
    if (centavos > 0) {
      if (reais > 0) result += ' e ';
      result += numberToWordsFull(centavos) + (centavos === 1 ? ' centavo' : ' centavos');
    }
    return result || 'zero reais';
  });
}

function normalizePercentagesTTS(text: string): string {
  return text.replace(/(\d+(?:[,.]\d+)?)\s?%/g, (_m, num) => {
    const val = parseFloat(num.replace(',', '.'));
    if (Number.isInteger(val)) return numberToWordsFull(val) + ' por cento';
    const intPart = Math.floor(val);
    const decPart = Math.round((val - intPart) * 10);
    return numberToWordsFull(intPart) + ' vírgula ' + numberToWordsFull(decPart) + ' por cento';
  });
}

const ACRONYMS_TTS: Record<string, string> = {
  'CPF': 'cê pê éfe', 'CNPJ': 'cê ene pê jota', 'RG': 'érre gê',
  'PIX': 'picks', 'CEO': 'cê i ôu', 'TI': 'tê í', 'RH': 'érre agá',
  'SMS': 'ésse ême ésse', 'PDF': 'pê dê éfe', 'CEP': 'cê ê pê',
  'ONG': 'ô ene gê', 'SUS': 'ésse ú ésse', 'INSS': 'í ene ésse ésse',
  'FGTS': 'éfe gê tê ésse', 'CLT': 'cê éle tê', 'MEI': 'mêi',
  'LTDA': 'limitada', 'S.A.': 'ésse á', 'SA': 'ésse á',
  'KG': 'quilos', 'kg': 'quilos', 'KM': 'quilômetros', 'km': 'quilômetros',
  'ML': 'mililitros', 'ml': 'mililitros', 'GB': 'gigabytes', 'MB': 'megabytes',
};

function normalizeAcronymsTTS(text: string): string {
  for (const [acr, spoken] of Object.entries(ACRONYMS_TTS)) {
    text = text.replace(new RegExp(`\\b${acr.replace('.', '\\.')}\\b`, 'g'), spoken);
  }
  const letters: Record<string, string> = {
    'A':'á','B':'bê','C':'cê','D':'dê','E':'ê','F':'éfe','G':'gê','H':'agá',
    'I':'í','J':'jota','K':'cá','L':'éle','M':'ême','N':'ene','O':'ó','P':'pê',
    'Q':'quê','R':'érre','S':'ésse','T':'tê','U':'ú','V':'vê','W':'dáblio',
    'X':'xis','Y':'ípsilon','Z':'zê',
  };
  text = text.replace(/\b([A-Z]{2,4})\b/g, (match) => {
    if (ACRONYMS_TTS[match]) return ACRONYMS_TTS[match];
    return match.split('').map(c => letters[c] || c).join(' ');
  });
  return text;
}

function normalizeOrdinalsTTS(text: string): string {
  const ordMap: Record<string, string> = {
    '1º': 'primeiro', '2º': 'segundo', '3º': 'terceiro', '4º': 'quarto', '5º': 'quinto',
    '6º': 'sexto', '7º': 'sétimo', '8º': 'oitavo', '9º': 'nono', '10º': 'décimo',
    '1ª': 'primeira', '2ª': 'segunda', '3ª': 'terceira', '4ª': 'quarta', '5ª': 'quinta',
    '6ª': 'sexta', '7ª': 'sétima', '8ª': 'oitava', '9ª': 'nona', '10ª': 'décima',
  };
  for (const [ord, spoken] of Object.entries(ordMap)) {
    text = text.replaceAll(ord, spoken);
  }
  return text;
}

function normalizeSymbolsTTS(text: string): string {
  return text
    .replace(/&/g, ' e ').replace(/@/g, ' arroba ').replace(/\+/g, ' mais ')
    .replace(/=/g, ' igual ').replace(/\//g, ' barra ').replace(/#/g, ' hashtag ')
    .replace(/\*/g, '').replace(/_/g, ' ')
    .replace(/\n+/g, '... ').replace(/\s{2,}/g, ' ');
}

function insertBreathingPausesTTS(text: string): string {
  let result = text;
  
  // Add micro-pauses at natural clause boundaries for human-like rhythm
  result = result.replace(/\b(mas|porém|então|porque|pois|quando|enquanto|embora)\s+/gi, '$1, ');
  
  // Natural pause after greetings/interjections
  result = result.replace(/^(oi|olá|bom dia|boa tarde|boa noite|tudo bem|e aí)\b/gi, '$1, ');
  
  // Sentence endings with proper spacing
  result = result.replace(/([.!?])\s+/g, '$1 ');
  
  // Ellipsis as natural pause
  result = result.replace(/\.{3,}/g, '... ');
  
  // Remove double commas
  result = result.replace(/,\s*,/g, ',');
  
  return result;
}

// ── Pronunciation corrections for proper nouns & brands commonly mispronounced by TTS ──
const TTS_PRONUNCIATION_FIXES: Record<string, string> = {
  'Audi': 'áudi', 'audi': 'áudi', 'AUDI': 'áudi',
  'Hyundai': 'riundái', 'hyundai': 'riundái',
  'Chevrolet': 'chevrôlé', 'chevrolet': 'chevrôlé',
  'Peugeot': 'pejô', 'peugeot': 'pejô',
  'Renault': 'renô', 'renault': 'renô',
  'Porsche': 'pórche', 'porsche': 'pórche',
  'Volkswagen': 'fólquisváguen', 'volkswagen': 'fólquisváguen',
  'BMW': 'bê ême dáblio',
  'Nissan': 'níçan', 'nissan': 'níçan',
  'Toyota': 'toiôta', 'toyota': 'toiôta',
  'Honda': 'rônda', 'honda': 'rônda',
  'Jeep': 'djípe', 'jeep': 'djípe',
  'Mitsubishi': 'mitsubíchi', 'Suzuki': 'suzúqui', 'Subaru': 'subáru',
  'Land Rover': 'lând rôver', 'Range Rover': 'rêindj rôver',
  'WhatsApp': 'uótsapp', 'whatsapp': 'uótsapp',
  'Instagram': 'instagrãm', 'instagram': 'instagrãm',
  'Facebook': 'feicebuk', 'facebook': 'feicebuk',
  'Google': 'gúgol', 'google': 'gúgol',
  'YouTube': 'iutúbi', 'youtube': 'iutúbi',
  'iPhone': 'aifôni', 'iphone': 'aifôni',
  'Wi-Fi': 'uaifai', 'wifi': 'uaifai', 'WiFi': 'uaifai',
  'delivery': 'delivéri', 'Delivery': 'delivéri',
  'online': 'onlaine', 'Online': 'onlaine',
  'email': 'iméil', 'Email': 'iméil', 'e-mail': 'iméil',
  'login': 'lóguin', 'Login': 'lóguin',
  'feedback': 'fídbéque', 'Feedback': 'fídbéque',
  'link': 'linque', 'Link': 'linque',
  'site': 'sáite', 'app': 'épp', 'App': 'épp',
  'shopping': 'chóping', 'Shopping': 'chóping',
  'QR code': 'quiú-ár côde', 'QR Code': 'quiú-ár côde',
  'drive-thru': 'dráive trú', 'self-service': 'sélfi sérvice',
  'checkout': 'tchéquiaut', 'Checkout': 'tchéquiaut',
  'cashback': 'quéchbéque', 'Cashback': 'quéchbéque',
};

function normalizePronunciationTTS(text: string): string {
  const entries = Object.entries(TTS_PRONUNCIATION_FIXES).sort((a, b) => b[0].length - a[0].length);
  for (const [word, phonetic] of entries) {
    if (word.includes(' ') || word.includes('-')) {
      text = text.replace(new RegExp(word.replace(/[-\s]/g, '[-\\s]'), 'gi'), phonetic);
    } else {
      text = text.replace(new RegExp(`\\b${word}\\b`, 'g'), phonetic);
    }
  }
  return text;
}

function normalizeNumbersForTTS(text: string): string {
  let normalized = text;
  normalized = normalizePronunciationTTS(normalized);
  normalized = normalizeCurrencyTTS(normalized);
  normalized = normalizePercentagesTTS(normalized);
  normalized = normalizeOrdinalsTTS(normalized);
  normalized = normalizeAcronymsTTS(normalized);
  normalized = normalized.replace(/\b(\d{1,7})\b/g, (_m, num) => {
    const n = parseInt(num, 10);
    if (n > 9999999) return num;
    return numberToWordsFull(n);
  });
  normalized = normalizeSymbolsTTS(normalized);
  normalized = insertBreathingPausesTTS(normalized);
  return normalized.trim();
}

async function sendElevenLabsAudioFromText(
  supabase: any,
  ctx: ExecutionContext,
  text: string,
  voiceId: string
): Promise<{ sent: boolean; reason?: string }> {
  if (!text) return { sent: false, reason: "empty_text" };

  // Try user setting first, fallback to project secret (ELEVENLABS_API_KEY)
  let elevenlabsKey = "";
  let userVoiceId = voiceId;
  let userModel = "eleven_turbo_v2_5";
  let voiceSettings: Record<string, any> | null = null;

  if (ctx.userId) {
    const { data: elSettings } = await supabase
      .from("settings")
      .select("value")
      .eq("user_id", ctx.userId)
      .eq("key", "elevenlabs")
      .single();
    
    const elConfig = elSettings?.value as any;
    if (elConfig) {
      elevenlabsKey = elConfig.apiKey || "";
      // Use user's custom voice ID or default voice ID if no override from node
      if (voiceId === "EXAVITQu4vr4xnSDxMaL") {
        // Node is using the default — prefer user's configured voice
        userVoiceId = elConfig.customVoiceId || elConfig.defaultVoiceId || voiceId;
      }
      userModel = elConfig.defaultModel || userModel;
      // Apply user's voice settings
      if (elConfig.stability !== undefined) {
        voiceSettings = {
          stability: elConfig.stability ?? 0.25,
          similarity_boost: elConfig.similarityBoost ?? 0.72,
          style: elConfig.style ?? 0.55,
          use_speaker_boost: elConfig.useSpeakerBoost ?? true,
          speed: elConfig.speed ?? 0.95,
        };
      }
    }
  }
  if (!elevenlabsKey) {
    elevenlabsKey = Deno.env.get("ELEVENLABS_API_KEY") || "";
  }

  if (!elevenlabsKey) {
    console.error("ElevenLabs API key not configured for TTS (settings/secrets)");
    return { sent: false, reason: "no_elevenlabs_key" };
  }

  console.log(`[TTS] Using voice=${userVoiceId}, model=${userModel}, hasSettings=${!!voiceSettings}`);

  // Normalize numbers for better pronunciation
  const ttsText = normalizeNumbersForTTS(text);
  console.log(`[TTS] Number normalization: "${text.slice(0, 60)}" → "${ttsText.slice(0, 60)}"`);

  // Call ElevenLabs TTS API directly
  const ttsBody: any = {
    text: ttsText,
    model_id: userModel,
  };
  // Apply humanized defaults if no user overrides
  if (voiceSettings) {
    ttsBody.voice_settings = voiceSettings;
  } else {
    ttsBody.voice_settings = {
      stability: 0.25,
      similarity_boost: 0.72,
      style: 0.55,
      use_speaker_boost: true,
      speed: 0.95,
    };
  }

  const ttsResp = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${userVoiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": elevenlabsKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(ttsBody),
    }
  );

  if (!ttsResp.ok) {
    const errText = await ttsResp.text();
    console.error(`ElevenLabs TTS error (${ttsResp.status}):`, errText.slice(0, 200));
    return { sent: false, reason: "tts_api_error" };
  }

  const audioBuffer = await ttsResp.arrayBuffer();
  const { encode: base64Encode } = await import("https://deno.land/std@0.168.0/encoding/base64.ts");
  const audioBase64 = base64Encode(audioBuffer);

  const audioSent = await sendWhatsAppAudio(supabase, ctx, audioBase64);
  if (!audioSent) {
    console.error("[TTS] Audio generated but WhatsApp send failed");
    return { sent: false, reason: "whatsapp_send_failed" };
  }
  return { sent: true };
}

function interpolate(text: string, ctx: ExecutionContext): string {
  return text
    .replace(/\{\{nome\}\}/gi, ctx.contactName)
    .replace(/\{\{name\}\}/gi, ctx.contactName)
    .replace(/\{\{phone\}\}/gi, ctx.contactPhone)
    .replace(/\{\{telefone\}\}/gi, ctx.contactPhone)
    .replace(/\{\{mensagem\}\}/gi, ctx.messageContent)
    .replace(/\{\{message\}\}/gi, ctx.messageContent)
    .replace(/\{\{([^}]+)\}\}/g, (_, key) => ctx.variables[key.trim()] || `{{${key}}}`);
}

// ── AUTO-ESCALATE HELPER: Reusable function for automatic human escalation ──
async function autoEscalateToHuman(supabase: any, ctx: ExecutionContext): Promise<void> {
  const transferMsg = "Entendi! Vou transferir você para um dos nossos atendentes agora. Aguarde um momento, por favor! 😊";

  // 1. Send transfer message
  const instance = await getCachedInstance(supabase, ctx.userId, ctx.instanceId);
  if (instance) {
    try {
      const sendUrl = `${instance.base_url}/send/text`;
      await fetch(sendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${instance.instance_token}` },
        body: JSON.stringify({ phone: ctx.contactPhone, message: transferMsg }),
      });
      await supabase.from("messages").insert({
        contact_id: ctx.contactId || null,
        user_id: ctx.userId,
        content: transferMsg,
        type: "text",
        direction: "outbound",
        status: "sent",
        metadata: { source: "automation" },
      });
    } catch (e) {
      console.error("[ESCALATE-AUTO] Failed to send transfer message:", e);
    }
  }

  // 2. Find agent with lowest workload
  let assignedToId: string | null = null;
  const { data: agents } = await supabase
    .from("profiles")
    .select("user_id, name")
    .neq("role", "user");

  if (agents && agents.length > 0) {
    let minLoad = Infinity;
    for (const agent of agents) {
      const { count } = await supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("assigned_to", agent.user_id)
        .in("status", ["open", "in_progress", "waiting"]);
      const load = count || 0;
      if (load < minLoad) {
        minLoad = load;
        assignedToId = agent.user_id;
      }
    }
  }

  // 3. Update conversation (preserve pending_occurrence flag in notes)
  const convUpdate: Record<string, any> = { status: "waiting", priority: "high" };
  if (assignedToId) convUpdate.assigned_to = assignedToId;
  await supabase.from("conversations").update(convUpdate).eq("id", ctx.conversationId);

  // 4. Add escalation tag
  if (ctx.contactId) {
    const tagName = "escalonado-humano";
    let { data: eTag } = await supabase.from("tags").select("id").ilike("name", tagName).maybeSingle();
    if (!eTag) {
      const { data: nTag } = await supabase.from("tags").insert({ name: tagName, color: "#ef4444", created_by: ctx.userId }).select("id").single();
      eTag = nTag;
    }
    if (eTag) {
      await supabase.from("contact_tags").upsert({ contact_id: ctx.contactId, tag_id: eTag.id }, { onConflict: "contact_id,tag_id" });
    }
  }

  // 5. Set flags
  ctx.variables["_escalated_to_human"] = "true";
  ctx.variables["_escalated_at"] = new Date().toISOString();
  if (assignedToId) ctx.variables["_escalated_agent_id"] = assignedToId;

  console.log(`[ESCALATE-AUTO] Conversation ${ctx.conversationId} auto-escalated. Agent=${assignedToId || "queue"}`);
}

// NOTE: sendTypingPresence removed — UazAPI v2 does not expose a presence/typing endpoint.
// All attempted endpoints (/send/presence, /chat/presence, /chat/updatePresence) return 405 Method Not Allowed.
// Typing simulation is achieved via a proportional delay before sending the message.

async function sendWhatsAppMessage(supabase: any, ctx: ExecutionContext, message: string): Promise<{ messageId: string | null; httpStatus: number; apiResponse: string }> {
  const cleanNumber = String(ctx.contactPhone || "").replace(/\D/g, "");
  if (!cleanNumber) {
    throw new Error("Número de telefone inválido para envio");
  }

  // ── Anti-duplication guard: block identical message to same contact within 30s ──
  const dedupeWindow = new Date(Date.now() - 30_000).toISOString();
  const msgPreview = message.slice(0, 200).trim();
  const { data: recentSent } = await supabase
    .from("messages")
    .select("id, content")
    .eq("contact_id", ctx.contactId)
    .eq("direction", "outbound")
    .gte("created_at", dedupeWindow)
    .order("created_at", { ascending: false })
    .limit(5);

  if (recentSent && recentSent.length > 0) {
    const isDuplicate = recentSent.some((m: any) => {
      const existing = (m.content || "").slice(0, 200).trim();
      // Only block EXACT matches (not partial) to avoid false positives
      return existing === msgPreview;
    });
    if (isDuplicate) {
      console.log(`Anti-dup: skipping duplicate message to ${cleanNumber}: "${msgPreview.slice(0, 50)}"`);
      return { messageId: null, httpStatus: 0, apiResponse: "skipped_duplicate" };
    }
  }

  // Get WhatsApp instance (cached)
  const instance = await getCachedInstance(supabase, ctx.userId, ctx.instanceId);
  if (!instance) {
    throw new Error("Instância WhatsApp não configurada para esta automação");
  }

  const baseUrl = String(instance.base_url).replace(/\/+$/, "");

  const resp = await fetch(`${baseUrl}/send/text`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      token: instance.instance_token,
    },
    body: JSON.stringify({
      number: cleanNumber,
      text: message,
    }),
  });

  const rawResponse = await resp.text();
  let result: any = {};
  try {
    result = rawResponse ? JSON.parse(rawResponse) : {};
  } catch {
    result = { raw: rawResponse };
  }

  const normalizeMsgId = (value: unknown): string | null => {
    if (!value) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const parts = raw.split(":").filter(Boolean);
    return parts.length > 1 ? parts[parts.length - 1] : raw;
  };

  const externalIdRaw =
    result?.messageid ||
    result?.messageId ||
    result?.key?.id ||
    result?.message?.key?.id ||
    result?.data?.key?.id ||
    result?.id ||
    null;

  const externalId = normalizeMsgId(externalIdRaw);
  const apiResponseSummary = JSON.stringify(result).slice(0, 300);

  if (!resp.ok || result?.error || result?.success === false) {
    throw new Error(result?.error || `Falha no envio (HTTP ${resp.status}): ${apiResponseSummary}`);
  }

  await supabase.from("messages").insert({
    contact_id: ctx.contactId,
    direction: "outbound",
    type: "text",
    content: message,
    status: "sent",
    external_id: externalId,
    metadata: { source: "automation" },
  });

  console.log(`Sent message to ${cleanNumber}: "${message.slice(0, 50)}" (id: ${externalId || "n/a"})`);

  return { messageId: externalId, httpStatus: resp.status, apiResponse: apiResponseSummary };
}

async function sendWhatsAppAudio(supabase: any, ctx: ExecutionContext, audioBase64: string): Promise<boolean> {
  try {
    const cleanNumber = String(ctx.contactPhone || "").replace(/\D/g, "");
    if (!cleanNumber) {
      console.error("[AUDIO SEND] Invalid phone number");
      return false;
    }

    const instance = await getCachedInstance(supabase, ctx.userId, ctx.instanceId);
    if (!instance) {
      console.error("[AUDIO SEND] No WhatsApp instance configured");
      return false;
    }

    const baseUrl = String(instance.base_url).replace(/\/+$/, "");

    // Upload audio to storage, then send via public URL
    const audioBytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
    const fileName = `tts_${Date.now()}_${cleanNumber}.mp3`;
    const { data: upload, error: uploadErr } = await supabase.storage
      .from("chat-media")
      .upload(`audio/${fileName}`, audioBytes, { contentType: "audio/mpeg" });

    if (uploadErr) {
      console.error("[AUDIO SEND] Storage upload error:", uploadErr.message);
      return false;
    }

    if (!upload?.path) {
      console.error("[AUDIO SEND] No upload path returned");
      return false;
    }

    const { data: urlData } = supabase.storage.from("chat-media").getPublicUrl(upload.path);
    const audioUrl = urlData?.publicUrl;

    if (!audioUrl) {
      console.error("[AUDIO SEND] Failed to get public URL");
      return false;
    }

    // Try /send/media with type=ptt first
    const sendBody = { number: cleanNumber, type: "ptt", file: audioUrl };
    console.log(`[AUDIO SEND] Sending PTT to ${cleanNumber} via /send/media, url=${audioUrl.slice(0, 60)}`);

    const resp = await fetch(`${baseUrl}/send/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: instance.instance_token },
      body: JSON.stringify(sendBody),
    });

    const respText = await resp.text();
    console.log(`[AUDIO SEND] /send/media response: status=${resp.status}, body=${respText.slice(0, 200)}`);

    let sent = resp.ok;

    if (!sent) {
      // Fallback: try /send/audio
      console.log("[AUDIO SEND] /send/media failed, trying /send/audio fallback");
      const resp2 = await fetch(`${baseUrl}/send/audio`, {
        method: "POST",
        headers: { "Content-Type": "application/json", token: instance.instance_token },
        body: JSON.stringify({ number: cleanNumber, file: audioUrl, ptt: true }),
      });
      const respText2 = await resp2.text();
      console.log(`[AUDIO SEND] /send/audio response: status=${resp2.status}, body=${respText2.slice(0, 200)}`);
      sent = resp2.ok;
    }

    if (sent) {
      await supabase.from("messages").insert({
        contact_id: ctx.contactId,
        direction: "outbound",
        type: "audio",
        content: "[Áudio automático - TTS]",
        status: "sent",
        metadata: { source: "automation" },
      });
      console.log(`[AUDIO SEND] Successfully sent audio to ${cleanNumber}`);
    } else {
      console.error(`[AUDIO SEND] All methods failed for ${cleanNumber}`);
    }

    return sent;
  } catch (err) {
    console.error("[AUDIO SEND] Exception:", err);
    return false;
  }
}

async function sendWhatsAppImage(supabase: any, ctx: ExecutionContext, imageUrl: string, caption?: string) {
  try {
    const cleanNumber = String(ctx.contactPhone || "").replace(/\D/g, "");
    const instance = await getCachedInstance(supabase, ctx.userId, ctx.instanceId);
    if (!instance) return;

    const baseUrl = String(instance.base_url).replace(/\/+$/, "");

    await fetch(`${baseUrl}/send/image`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        token: instance.instance_token || "",
      },
      body: JSON.stringify({
        number: cleanNumber,
        image: imageUrl,
        caption: caption || "",
      }),
    });

    await supabase.from("messages").insert({
      contact_id: ctx.contactId,
      direction: "outbound",
      type: "image",
      content: caption || "[Imagem gerada por IA]",
      media_url: imageUrl,
      status: "sent",
      metadata: { source: "automation" },
    });

    console.log(`Sent image to ${cleanNumber}`);
  } catch (err) {
    console.error("Failed to send image:", err);
  }
}

// ── Re-download encrypted media via UazAPI and upload to storage ──
async function tryUazapiMediaDownload(
  supabase: any,
  ctx: ExecutionContext,
  audioMsg: any,
  originalUrl: string
): Promise<{ url: string; blob: Blob } | null> {
  try {
    // Find the external_id for this message to use in UazAPI download
    const { data: msgRecord } = await supabase
      .from("messages")
      .select("external_id")
      .eq("contact_id", ctx.contactId)
      .eq("media_url", originalUrl)
      .eq("direction", "inbound")
      .limit(1)
      .maybeSingle();

    const externalId = msgRecord?.external_id;
    if (!externalId) {
      console.log("[TRANSCRIBE] No external_id found for audio message");
      return null;
    }

    // Get the WhatsApp instance config
    const instance = await getCachedInstance(supabase, ctx.userId, ctx.instanceId);
    if (!instance) {
      console.log("[TRANSCRIBE] No WhatsApp instance for UazAPI download");
      return null;
    }

    const baseUrl = String(instance.base_url).replace(/\/+$/, "");
    const token = instance.instance_token;

    // Try multiple download endpoints
    const downloadAttempts = [
      { ep: "/message/downloadMediaMessage", body: { id: externalId } },
      { ep: "/message/downloadMediaMessage", body: { messageId: externalId } },
      { ep: "/chat/downloadMediaMessage", body: { id: externalId } },
      { ep: "/message/download", body: { id: externalId } },
    ];

    for (const attempt of downloadAttempts) {
      try {
        console.log(`[TRANSCRIBE] Trying UazAPI: POST ${attempt.ep}`);
        const resp = await fetch(`${baseUrl}${attempt.ep}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", token },
          body: JSON.stringify(attempt.body),
        });

        if (resp.status === 404 || resp.status === 405 || resp.status === 400) continue;

        if (!resp.ok) {
          console.log(`[TRANSCRIBE] UazAPI ${attempt.ep} returned ${resp.status}`);
          continue;
        }

        const contentType = resp.headers.get("content-type") || "application/octet-stream";

        if (contentType.includes("application/json")) {
          const dlData = await resp.json();
          const downloadedUrl = dlData.url || dlData.fileURL || dlData.fileUrl || dlData.mediaUrl || dlData.file || dlData.data?.url || "";
          const base64Data = dlData.base64 || dlData.data || "";

          if (downloadedUrl && typeof downloadedUrl === "string" && downloadedUrl.startsWith("http")) {
            const fileResp = await fetch(downloadedUrl);
            if (fileResp.ok) {
              const fileBuffer = await fileResp.arrayBuffer();
              const blob = new Blob([new Uint8Array(fileBuffer)], { type: "audio/ogg" });
              // Upload to storage
              const phone = ctx.contactPhone.replace(/\D/g, "");
              const fileName = `media/${phone}/${Date.now()}_${externalId.slice(-8)}.ogg`;
              const { data: upload } = await supabase.storage
                .from("chat-media")
                .upload(fileName, new Uint8Array(fileBuffer), { contentType: "audio/ogg" });
              if (upload?.path) {
                const { data: urlData } = supabase.storage.from("chat-media").getPublicUrl(upload.path);
                // Update the message record with new URL
                await supabase.from("messages").update({ media_url: urlData.publicUrl }).eq("external_id", externalId).eq("direction", "inbound");
                console.log(`[TRANSCRIBE] Re-uploaded audio to storage: ${urlData.publicUrl.slice(0, 60)}`);
                return { url: urlData.publicUrl, blob };
              }
              return { url: downloadedUrl, blob };
            }
          } else if (base64Data && typeof base64Data === "string" && base64Data.length > 100) {
            const binaryData = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
            const blob = new Blob([binaryData], { type: "audio/ogg" });
            const phone = ctx.contactPhone.replace(/\D/g, "");
            const fileName = `media/${phone}/${Date.now()}_${externalId.slice(-8)}.ogg`;
            const { data: upload } = await supabase.storage
              .from("chat-media")
              .upload(fileName, binaryData, { contentType: "audio/ogg" });
            if (upload?.path) {
              const { data: urlData } = supabase.storage.from("chat-media").getPublicUrl(upload.path);
              await supabase.from("messages").update({ media_url: urlData.publicUrl }).eq("external_id", externalId).eq("direction", "inbound");
              console.log(`[TRANSCRIBE] Uploaded base64 audio to storage: ${urlData.publicUrl.slice(0, 60)}`);
              return { url: urlData.publicUrl, blob };
            }
          }
        } else {
          // Binary response
          const buffer = await resp.arrayBuffer();
          if (buffer.byteLength > 100) {
            const blob = new Blob([new Uint8Array(buffer)], { type: contentType });
            const phone = ctx.contactPhone.replace(/\D/g, "");
            const fileName = `media/${phone}/${Date.now()}_${externalId.slice(-8)}.ogg`;
            const { data: upload } = await supabase.storage
              .from("chat-media")
              .upload(fileName, new Uint8Array(buffer), { contentType });
            if (upload?.path) {
              const { data: urlData } = supabase.storage.from("chat-media").getPublicUrl(upload.path);
              await supabase.from("messages").update({ media_url: urlData.publicUrl }).eq("external_id", externalId).eq("direction", "inbound");
              console.log(`[TRANSCRIBE] Uploaded binary audio to storage: ${urlData.publicUrl.slice(0, 60)}`);
              return { url: urlData.publicUrl, blob };
            }
          }
        }
      } catch (fetchErr) {
        console.log(`[TRANSCRIBE] UazAPI ${attempt.ep} error: ${fetchErr}`);
      }
    }

    console.log("[TRANSCRIBE] All UazAPI download attempts failed");
    return null;
  } catch (err) {
    console.error("[TRANSCRIBE] tryUazapiMediaDownload error:", err);
    return null;
  }
}
