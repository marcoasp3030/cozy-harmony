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
      action_send_media: "Enviar Mídia",
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
      const intentsRaw = String(d.intents || "dúvida, reclamação, compra, suporte, saudação");
      const intents = intentsRaw.split(",").map((i: string) => i.trim()).filter(Boolean);
      const threshold = parseInt(d.confidence_threshold) || 60;
      const customPrompt = d.custom_prompt || "";

      const classifyPrompt = `Você é um classificador de intenções de mensagens de clientes via WhatsApp.
Classifique a mensagem do cliente em UMA das seguintes intenções: ${intents.join(", ")}.
${customPrompt ? `Contexto adicional: ${customPrompt}` : ""}

Responda APENAS com um JSON válido no formato:
{"intent": "<intenção>", "confidence": <0-100>}

Mensagem do cliente: "${ctx.messageContent}"`;

      let reply = "";
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

      if (LOVABLE_API_KEY) {
        try {
          const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash-lite",
              messages: [{ role: "user", content: classifyPrompt }],
              max_tokens: 100,
              temperature: 0.1,
            }),
          });
          if (resp.ok) {
            const data = await resp.json();
            reply = data.choices?.[0]?.message?.content?.trim() || "";
          }
        } catch (e) {
          console.error("Intent classifier AI error:", e);
        }
      }

      if (!reply) {
        // No AI available, default to first intent
        ctx.variables["intencao"] = intents[0] || "desconhecido";
        ctx.variables["intencao_confianca"] = "0";
        return true; // pass through yes path
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

          console.log(`Intent classified: "${detectedIntent}" (${confidence}%) threshold=${threshold}%`);

          // Returns true (yes path) if confidence meets threshold
          return confidence >= threshold;
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
      const bodyText = interpolate(String(d.body_text || ""), ctx);
      const footer = interpolate(String(d.footer || ""), ctx);
      const buttonTitle = interpolate(String(d.button_title || "Ver opções"), ctx);
      const optionsRaw = String(d.options || "").trim();

      if (!bodyText || !optionsRaw) return { sent: false, reason: "empty_body_or_options" };

      const lines = optionsRaw.split("\n").map((l: string) => l.trim()).filter(Boolean);

      // Get WhatsApp instance
      let query = supabase
        .from("whatsapp_instances")
        .select("id, base_url, instance_token")
        .order("is_default", { ascending: false })
        .limit(1);
      if (ctx.userId) query = query.eq("user_id", ctx.userId);
      const { data: instance } = await query.maybeSingle();
      if (!instance?.base_url || !instance?.instance_token) {
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
        message: bodyText,
        options: optionStrings,
      };

      if (interactiveType === "buttons") {
        payload.type = "button";
      } else {
        payload.type = "list";
        payload.title = buttonTitle;
      }

      if (footer) payload.footer = footer;

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
        metadata: { interactive_type: interactiveType, options: optionStrings, footer },
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

      // Get WhatsApp instance
      let query = supabase
        .from("whatsapp_instances")
        .select("id, base_url, instance_token")
        .order("is_default", { ascending: false })
        .limit(1);
      if (ctx.userId) query = query.eq("user_id", ctx.userId);
      const { data: instance } = await query.maybeSingle();
      if (!instance?.base_url || !instance?.instance_token) {
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
        throw new Error(result?.error || `Falha no envio de mídia (HTTP ${resp.status})`);
      }

      // Save to messages table
      await supabase.from("messages").insert({
        contact_id: ctx.contactId,
        direction: "outbound",
        type: mediaType,
        content: caption || null,
        media_url: mediaUrl,
        status: "sent",
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
      const systemPrompt = interpolate(String(d.system_prompt || "Você é um assistente de atendimento."), ctx);
      const provider = d.provider || "openai";
      const model = d.model || (provider === "openai" ? "gpt-4o-mini" : "gemini-2.5-flash");
      const maxTokens = parseInt(d.max_tokens) || 500;

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
        .in("key", ["llm_openai", "llm_gemini"]);

      const keys: Record<string, string> = {};
      for (const s of (settings || [])) {
        const val = s.value as { apiKey?: string };
        if (s.key === "llm_openai" && val?.apiKey) keys.openai = val.apiKey;
        if (s.key === "llm_gemini" && val?.apiKey) keys.gemini = val.apiKey;
      }

      // ── Whisper: transcribe last inbound audio ──
      if (model === "whisper-1") {
        if (!keys.openai) return { sent: false, reason: "openai_key_missing" };
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
          const transcription = result.text || "";
          if (transcription) {
            const replyText = systemPrompt
              ? interpolate(systemPrompt.replace(/\{\{transcricao\}\}/gi, transcription), ctx)
              : `Transcrição: ${transcription}`;
            await sendWhatsAppMessage(supabase, ctx, replyText);
          }
          return { sent: true, model, transcription: transcription.slice(0, 100) };
        }
        const errText = await whisperResp.text();
        throw new Error(`Whisper error (${whisperResp.status}): ${errText.slice(0, 200)}`);
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

      // ── Standard chat models (GPT, Gemini chat) ──
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

      const chatMessages = [
        { role: "system", content: systemPrompt },
        ...messages.map((m: any) => ({
          role: m.direction === "inbound" ? "user" : "assistant",
          content: m.content,
        })),
      ];

      let reply = "";

      // Try user's own API key first, fallback to Lovable AI Gateway
      const selectedProvider = model.startsWith("gemini") ? "gemini" : "openai";
      const hasUserKey = !!keys[selectedProvider];

      if (hasUserKey) {
        try {
          if (selectedProvider === "openai") {
            const resp = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: { Authorization: `Bearer ${keys.openai}`, "Content-Type": "application/json" },
              body: JSON.stringify({ model, messages: chatMessages, max_tokens: maxTokens, temperature: 0.7 }),
            });
            if (resp.ok) {
              const data = await resp.json();
              reply = data.choices?.[0]?.message?.content?.trim() || "";
            } else {
              const errText = await resp.text();
              console.error(`OpenAI user key failed (${resp.status}), falling back to Lovable AI: ${errText.slice(0, 100)}`);
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
                  generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
                }),
              }
            );
            if (resp.ok) {
              const data = await resp.json();
              reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
            } else {
              const errText = await resp.text();
              console.error(`Gemini user key failed (${resp.status}), falling back to Lovable AI: ${errText.slice(0, 100)}`);
            }
          }
        } catch (userKeyErr) {
          console.error(`User key error, falling back to Lovable AI:`, userKeyErr);
        }
      }

      // Fallback to Lovable AI Gateway if no reply yet
      if (!reply) {
        const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
        if (LOVABLE_API_KEY) {
          console.log("Using Lovable AI Gateway as fallback");
          // Map model to Lovable AI supported model
          const lovableModel = model.startsWith("gemini") ? "google/gemini-2.5-flash" : "google/gemini-3-flash-preview";
          const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: lovableModel,
              messages: chatMessages,
              max_tokens: maxTokens,
              temperature: 0.7,
            }),
          });
          if (resp.ok) {
            const data = await resp.json();
            reply = data.choices?.[0]?.message?.content?.trim() || "";
          } else {
            const errText = await resp.text();
            throw new Error(`Lovable AI error (${resp.status}): ${errText.slice(0, 200)}`);
          }
        } else if (!hasUserKey) {
          throw new Error("Nenhuma API key configurada (OpenAI/Gemini) e Lovable AI não disponível");
        }
      }

      if (reply) {
        // Store IA reply as variable for downstream nodes (e.g. TTS with {{ia_reply}})
        ctx.variables["ia_reply"] = reply;
        // Only send as text message if suppress_send is not set
        if (!d.suppress_send) {
          await sendWhatsAppMessage(supabase, ctx, reply);
        }
      }
      return { sent: !!reply, model, reply: (reply || "").slice(0, 80), suppressed: !!d.suppress_send };
    }

    if (type === "action_elevenlabs_tts") {
      const text = interpolate(String(d.text || ""), ctx);
      if (!text) return { sent: false, reason: "empty_text" };

      const voiceId = d.voice_id || "EXAVITQu4vr4xnSDxMaL";

      // Load ElevenLabs API key from user settings directly
      let elevenlabsKey = "";
      if (ctx.userId) {
        const { data: elSettings } = await supabase
          .from("settings")
          .select("value")
          .eq("user_id", ctx.userId)
          .eq("key", "elevenlabs")
          .single();
        elevenlabsKey = (elSettings?.value as any)?.apiKey || "";
      }

      if (!elevenlabsKey) {
        console.error("ElevenLabs API key not configured for TTS");
        // Fallback: send as text message instead
        await sendWhatsAppMessage(supabase, ctx, text);
        return { sent: true, fallback: "text", reason: "no_elevenlabs_key" };
      }

      // Call ElevenLabs TTS API directly (bypass edge function auth issues)
      const ttsResp = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: {
            "xi-api-key": elevenlabsKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text,
            model_id: "eleven_multilingual_v2",
          }),
        }
      );

      if (!ttsResp.ok) {
        const errText = await ttsResp.text();
        console.error(`ElevenLabs TTS error (${ttsResp.status}):`, errText.slice(0, 200));
        // Fallback: send as text
        await sendWhatsAppMessage(supabase, ctx, text);
        return { sent: true, fallback: "text", reason: "tts_api_error" };
      }

      const audioBuffer = await ttsResp.arrayBuffer();
      const { encode: base64Encode } = await import("https://deno.land/std@0.168.0/encoding/base64.ts");
      const audioBase64 = base64Encode(audioBuffer);

      await sendWhatsAppAudio(supabase, ctx, audioBase64);
      return { sent: true, tts: true, voiceId };
    }

    if (type === "action_ab_split") {
      const splitPct = parseInt(d.split_percentage) || 50;
      return Math.random() * 100 < splitPct; // true = path A, false = path B
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
      const waitSeconds = parseInt(d.wait_seconds) || 15;
      const maxMessages = parseInt(d.max_messages) || 10;
      // Wait for the specified interval (capped at 25s for edge function limit)
      const waitMs = Math.min(waitSeconds * 1000, 25000);
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

      // Aggregate all message contents into context
      const aggregated = (batchMsgs || [])
        .map((m: any) => {
          if (m.type === "text" || m.type === "chat") return m.content || "";
          if (m.type === "audio" || m.type === "ptt") return `[Áudio: ${m.media_url || "sem URL"}]`;
          if (m.type === "document") return `[Documento: ${m.media_url || "sem URL"}]`;
          if (m.type === "image") return `[Imagem: ${m.media_url || "sem URL"}]`;
          return m.content || `[${m.type}]`;
        })
        .filter(Boolean)
        .join("\n");

      // Update context with aggregated messages
      ctx.messageContent = aggregated || ctx.messageContent;
      ctx.variables["mensagens_agrupadas"] = aggregated;
      ctx.variables["total_mensagens"] = String((batchMsgs || []).length);

      return { collected: (batchMsgs || []).length, aggregated: aggregated.slice(0, 200) };
    }

    if (type === "action_transcribe_audio") {
      const provider = d.provider || "whisper";
      const language = d.language || "pt";

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
        ctx.variables["transcricao"] = "";
        return { transcribed: false, reason: "no_audio_found" };
      }

      // Download audio
      const audioResp = await fetch(audioUrl);
      if (!audioResp.ok) {
        return { transcribed: false, reason: "audio_download_failed" };
      }
      const audioBlob = await audioResp.blob();

      let transcription = "";

      if (provider === "elevenlabs") {
        // Use ElevenLabs STT edge function
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
          transcription = result.text || "";
        }
      } else {
        // Use Lovable AI Gateway (no user key needed) or fallback to user's OpenAI key
        const { data: ownerAuto } = await supabase.from("automations").select("created_by").limit(1).single();
        let openaiKey = "";
        if (ownerAuto?.created_by) {
          const { data: s } = await supabase.from("settings").select("value").eq("user_id", ownerAuto.created_by).eq("key", "llm_openai").single();
          openaiKey = (s?.value as any)?.apiKey || "";
        }

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
            transcription = result.text || "";
          } else {
            console.error(`Whisper failed, no fallback for audio transcription`);
          }
        } else {
          console.log("No OpenAI key for Whisper, skipping transcription");
        }
      }

      ctx.variables["transcricao"] = transcription;
      // Append transcription to message content for downstream IA nodes
      if (transcription) {
        ctx.messageContent += `\n\n[Transcrição do áudio]: ${transcription}`;
      }
      return { transcribed: !!transcription, transcription: transcription.slice(0, 200) };
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
        const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
        if (LOVABLE_API_KEY) {
          const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [
                { role: "system", content: "Resuma o conteúdo do documento de forma clara e objetiva em português. Máximo 500 palavras." },
                { role: "user", content: extractedText },
              ],
              max_tokens: 600,
            }),
          });
          if (resp.ok) {
            const data = await resp.json();
            const summary = data.choices?.[0]?.message?.content?.trim() || "";
            if (summary) extractedText = summary;
          }
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
    const cleanNumber = String(ctx.contactPhone || "").replace(/\D/g, "");
    if (!cleanNumber) return;

    let query = supabase
      .from("whatsapp_instances")
      .select("id, base_url, instance_token")
      .order("is_default", { ascending: false })
      .limit(1);
    if (ctx.userId) query = query.eq("user_id", ctx.userId);
    const { data: instance } = await query.maybeSingle();

    if (!instance?.base_url || !instance?.instance_token) {
      console.error("No WhatsApp instance for audio send");
      return;
    }

    const baseUrl = String(instance.base_url).replace(/\/+$/, "");

    // Upload audio to storage, then send via public URL
    const audioBytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
    const fileName = `tts_${Date.now()}.mp3`;
    const { data: upload } = await supabase.storage
      .from("chat-media")
      .upload(`audio/${fileName}`, audioBytes, { contentType: "audio/mpeg" });

    if (upload?.path) {
      const { data: urlData } = supabase.storage.from("chat-media").getPublicUrl(upload.path);
      const audioUrl = urlData?.publicUrl;

      if (audioUrl) {
        await fetch(`${baseUrl}/send/audio`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            token: instance.instance_token,
          },
          body: JSON.stringify({
            number: cleanNumber,
            url: audioUrl,
            ptt: true,
          }),
        });
        console.log(`Sent audio to ${cleanNumber} via storage URL`);
      }
    }

    await supabase.from("messages").insert({
      contact_id: ctx.contactId,
      direction: "outbound",
      type: "audio",
      content: "[Áudio automático - TTS]",
      status: "sent",
    });
  } catch (err) {
    console.error("Failed to send audio:", err);
  }
}

async function sendWhatsAppImage(supabase: any, ctx: ExecutionContext, imageUrl: string, caption?: string) {
  try {
    const cleanNumber = String(ctx.contactPhone || "").replace(/\D/g, "");
    let query = supabase
      .from("whatsapp_instances")
      .select("id, base_url, instance_token")
      .order("is_default", { ascending: false })
      .limit(1);
    if (ctx.userId) query = query.eq("user_id", ctx.userId);
    const { data: instance } = await query.maybeSingle();
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
    });

    console.log(`Sent image to ${cleanNumber}`);
  } catch (err) {
    console.error("Failed to send image:", err);
  }
}
