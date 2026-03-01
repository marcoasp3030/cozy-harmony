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
  variables: Record<string, string>;
  isFirstContact: boolean;
  nodeLog: NodeLogEntry[];
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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
      conversationId,
      isFirstContact,
    } = await req.json();

    console.log(`Automation trigger: phone=${contactPhone}, msg="${(messageContent || "").slice(0, 50)}", firstContact=${isFirstContact}`);

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

      console.log(`Automation "${automation.name}" (${automation.id}) triggered`);

      const startTime = Date.now();
      const ctx: ExecutionContext = {
        contactId,
        contactPhone,
        contactName: contactName || "",
        messageContent: messageContent || "",
        messageType: messageType || "text",
        conversationId,
        userId: automation.created_by || null,
        variables: {},
        isFirstContact: !!isFirstContact,
        nodeLog: [],
      };

      // Create log entry
      const { data: logEntry, error: logInsertErr } = await supabase
        .from("automation_logs")
        .insert({
          automation_id: automation.id,
          contact_id: contactId || null,
          contact_phone: contactPhone,
          trigger_type: automation.trigger_type,
          status: "running",
        })
        .select("id")
        .single();

      if (logInsertErr) {
        console.error(`Failed to create log entry: ${logInsertErr.message}`, logInsertErr);
      } else {
        console.log(`Log entry created: ${logEntry?.id}`);
      }

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

      // Update log entry with results
      if (logEntry) {
        await supabase
          .from("automation_logs")
          .update({
            status: execError ? "error" : "completed",
            completed_at: new Date().toISOString(),
            duration_ms: durationMs,
            nodes_executed: ctx.nodeLog,
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
      condition_contact_field: "Campo do Contato", action_send_message: "Enviar Mensagem",
      action_send_template: "Enviar Template", action_add_tag: "Adicionar Tag",
      action_remove_tag: "Remover Tag", action_assign_agent: "Atribuir Atendente",
      action_move_funnel: "Mover no Funil", action_delay: "Aguardar",
      action_set_variable: "Definir Variável", action_update_score: "Atualizar Score",
      action_http_webhook: "HTTP Webhook", action_llm_reply: "Resposta IA",
      action_elevenlabs_tts: "Áudio ElevenLabs", action_ab_split: "Split A/B",
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

    // ── ACTIONS ──
    if (type === "action_send_message") {
      const message = interpolate(String(d.message || ""), ctx);
      if (!message) return { sent: false, reason: "empty_message" };
      const sendResult = await sendWhatsAppMessage(supabase, ctx, message);
      return { sent: true, ...sendResult };
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
      // Get recent messages for context
      const { data: recentMsgs } = await supabase
        .from("messages")
        .select("direction, content, type")
        .eq("contact_id", ctx.contactId)
        .order("created_at", { ascending: false })
        .limit(10);

      const messages = (recentMsgs || []).reverse().map((m: any) => ({
        direction: m.direction,
        content: m.content || "[mídia]",
      }));

      const systemPrompt = interpolate(String(d.system_prompt || "Você é um assistente de atendimento."), ctx);
      const provider = d.provider || "openai";
      const model = d.model || (provider === "openai" ? "gpt-4o-mini" : "gemini-2.5-flash");

      // Call llm-reply edge function internally
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      // First get user settings to find API keys
      const { data: ownerAutomation } = await supabase
        .from("automations")
        .select("created_by")
        .limit(1)
        .single();

      if (ownerAutomation?.created_by) {
        const { data: settings } = await supabase
          .from("settings")
          .select("key, value")
          .eq("user_id", ownerAutomation.created_by)
          .in("key", ["llm_openai", "llm_gemini"]);

        const keys: Record<string, string> = {};
        for (const s of (settings || [])) {
          const val = s.value as { apiKey?: string };
          if (s.key === "llm_openai" && val?.apiKey) keys.openai = val.apiKey;
          if (s.key === "llm_gemini" && val?.apiKey) keys.gemini = val.apiKey;
        }

        const selectedProvider = provider || (keys.openai ? "openai" : keys.gemini ? "gemini" : null);
        if (selectedProvider && keys[selectedProvider]) {
          const chatMessages = [
            { role: "system", content: systemPrompt },
            ...messages.map((m: any) => ({
              role: m.direction === "inbound" ? "user" : "assistant",
              content: m.content,
            })),
          ];

          let reply = "";
          if (selectedProvider === "openai") {
            const resp = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: { Authorization: `Bearer ${keys.openai}`, "Content-Type": "application/json" },
              body: JSON.stringify({ model, messages: chatMessages, max_tokens: parseInt(d.max_tokens) || 500, temperature: 0.7 }),
            });
            if (resp.ok) {
              const data = await resp.json();
              reply = data.choices?.[0]?.message?.content?.trim() || "";
            }
          } else {
            const geminiContents = chatMessages.filter((m: any) => m.role !== "system").map((m: any) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            }));
            const resp = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${keys.gemini}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  system_instruction: { parts: [{ text: systemPrompt }] },
                  contents: geminiContents,
                  generationConfig: { maxOutputTokens: parseInt(d.max_tokens) || 500, temperature: 0.7 },
                }),
              }
            );
            if (resp.ok) {
              const data = await resp.json();
              reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
            }
          }

          if (reply) {
            await sendWhatsAppMessage(supabase, ctx, reply);
          }
        }
      }
      return true;
    }

    if (type === "action_elevenlabs_tts") {
      const text = interpolate(String(d.text || ""), ctx);
      const voiceId = d.voice_id || "21m00Tcm4TlvDq8ikWAM";
      // Call elevenlabs-tts function
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const resp = await fetch(`${supabaseUrl}/functions/v1/elevenlabs-tts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice_id: voiceId }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.audio_base64) {
          // Send as audio message via WhatsApp
          await sendWhatsAppAudio(supabase, ctx, data.audio_base64);
        }
      }
      return true;
    }

    if (type === "action_ab_split") {
      const splitPct = parseInt(d.split_percentage) || 50;
      return Math.random() * 100 < splitPct; // true = path A, false = path B
    }

    console.log(`Unknown node type: ${type}`);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    console.error(`Error executing node ${type} (${node.id}):`, err);
    throw new Error(message);
  }
}

// ── Helpers ──────────────────────────────────────────────────

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

async function sendWhatsAppMessage(supabase: any, ctx: ExecutionContext, message: string): Promise<{ messageId: string | null; httpStatus: number; apiResponse: string }> {
  const cleanNumber = String(ctx.contactPhone || "").replace(/\D/g, "");
  if (!cleanNumber) {
    throw new Error("Número de telefone inválido para envio");
  }

  let query = supabase
    .from("whatsapp_instances")
    .select("id, base_url, instance_token")
    .order("is_default", { ascending: false })
    .limit(1);

  if (ctx.userId) {
    query = query.eq("user_id", ctx.userId);
  }

  const { data: instance, error: instanceErr } = await query.maybeSingle();

  if (instanceErr || !instance?.base_url || !instance?.instance_token) {
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
  });

  console.log(`Sent message to ${cleanNumber}: "${message.slice(0, 50)}" (id: ${externalId || "n/a"})`);

  return { messageId: externalId, httpStatus: resp.status, apiResponse: apiResponseSummary };
}

async function sendWhatsAppAudio(supabase: any, ctx: ExecutionContext, audioBase64: string) {
  try {
    const { data: instance } = await supabase
      .from("whatsapp_instances")
      .select("id, base_url, instance_token")
      .eq("is_default", true)
      .limit(1)
      .single();

    if (!instance) return;

    await fetch(`${instance.base_url}/message/send-audio`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        token: instance.instance_token || "",
      },
      body: JSON.stringify({
        phone: ctx.contactPhone,
        audio: audioBase64,
        ptt: true,
      }),
    });

    await supabase.from("messages").insert({
      contact_id: ctx.contactId,
      direction: "outbound",
      type: "audio",
      content: "[Áudio automático]",
      status: "sent",
    });

    console.log(`Sent audio to ${ctx.contactPhone}`);
  } catch (err) {
    console.error("Failed to send audio:", err);
  }
}
