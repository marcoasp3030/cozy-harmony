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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Clear instance cache per request
  instanceCache.clear();

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

    console.log(`Automation trigger: phone=${contactPhone}, type=${messageType}, msg="${(messageContent || "").slice(0, 50)}"`);

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

      // ── Debounce: use insert-first pattern to prevent race conditions ──
      const collectNode = flow.nodes.find((n: FlowNode) => n.data?.nodeType === "action_collect_messages");
      const debounceSeconds = collectNode ? (parseInt(collectNode.data.wait_seconds) || 15) + 10 : 12;

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
        // Delete our duplicate log entry
        await supabase.from("automation_logs").delete().eq("id", logEntry.id);
        console.log(`Debounce: skipping automation "${automation.name}" for ${contactPhone} (older run ${recentRuns[0].id})`);
        continue;
      }

      console.log(`Automation "${automation.name}" (${automation.id}) triggered, log=${logEntry.id}`);

      const startTime = Date.now();
      const ctx: ExecutionContext = {
        contactId,
        contactPhone,
        contactName: contactName || "",
        messageContent: messageContent || "",
        messageType: messageType || "text",
        conversationId,
        userId: automation.created_by || null,
        instanceId: automation.instance_id || null,
        variables: {},
        isFirstContact: !!isFirstContact,
        nodeLog: [],
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
      action_send_media: "Enviar Mídia", action_register_occurrence: "Registrar Ocorrência",
      action_analyze_image: "Analisar Imagem", action_search_product: "Buscar Produto",
      action_verify_payment: "Verificar Comprovante PIX",
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
${customPrompt ? `Contexto adicional: ${customPrompt}` : ""}

Responda APENAS com um JSON válido no formato:
{"intent": "<intenção>", "confidence": <0-100>}

Mensagem do cliente: "${classifyContent.slice(0, 500)}"`;

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

      // ── AUTO-INJECT PRODUCT INFO for payment-related interactive messages ──
      const isPaymentMsg = /pix|pagamento|pagar|valor|chave/i.test(bodyText);
      if (isPaymentMsg && ctx.userId) {
        // Check if we already have product info from a previous node
        if (ctx.variables["produto_encontrado"] === "true" && ctx.variables["produto_nome"] && ctx.variables["produto_preco"]) {
          const prodName = ctx.variables["produto_nome"];
          const prodPrice = Number(ctx.variables["produto_preco"]).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
          bodyText = `🛒 Produto: *${prodName}*\n💰 Valor: *${prodPrice}*\n\n${bodyText}`;
          console.log(`[PIX] Injected product info: ${prodName} = ${prodPrice}`);
        } else {
          // Try to find product from recent conversation context
          const grouped = ctx.variables["mensagens_agrupadas"] || "";
          const transcription = ctx.variables["transcricao"] || "";
          const imageProduct = ctx.variables["produto_identificado"] || ctx.variables["descricao_imagem"] || "";
          const searchText = imageProduct || grouped || transcription || ctx.messageContent || "";

          if (searchText.length > 2) {
            try {
              // Extract meaningful words for search
              const stopWords = new Set(["para", "como", "quero", "saber", "qual", "esse", "essa", "favor", "pode", "aqui", "mais", "muito", "obrigado", "obrigada", "sobre", "tenho", "estou", "esta", "isso", "peguei", "produto", "valor", "preco", "pagar", "pagamento", "chave"]);
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
                  // No product found — prepend a warning asking the client to identify the product
                  bodyText = `⚠️ Não consegui identificar o produto. Poderia enviar uma foto do produto ou código de barras para eu verificar o valor?\n\n${bodyText}`;
                  console.log(`[PIX] No product found for query: "${query}" — asking client to identify`);
                }
              } else {
                bodyText = `⚠️ Para seguir com o pagamento, preciso saber qual produto você pegou. Poderia me informar o nome ou enviar uma foto?\n\n${bodyText}`;
                console.log(`[PIX] No search query available — asking client to identify product`);
              }
            } catch (e) {
              console.error("[PIX] Product search error:", e);
            }
          } else {
            bodyText = `⚠️ Para seguir com o pagamento, preciso saber qual produto você pegou. Poderia me informar o nome ou enviar uma foto?\n\n${bodyText}`;
            console.log(`[PIX] No context for product search — asking client`);
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

    if (type === "action_register_occurrence") {
      const defaultType = d.occurrence_type || "reclamacao";
      const priority = d.priority || "normal";

      // ── Dedup: skip if there's already a recent occurrence for this contact ──
      const dedupMinutes = 30;
      const dedupCutoff = new Date(Date.now() - dedupMinutes * 60 * 1000).toISOString();
      const { data: recentOcc } = await supabase
        .from("occurrences")
        .select("id, type, created_at")
        .eq("contact_phone", ctx.contactPhone)
        .gte("created_at", dedupCutoff)
        .order("created_at", { ascending: false })
        .limit(1);

      if (recentOcc && recentOcc.length > 0) {
        console.log(`[OCCURRENCE] Dedup: skipping for ${ctx.contactPhone}, recent occurrence ${recentOcc[0].id} (${recentOcc[0].type}) at ${recentOcc[0].created_at}`);
        return { registered: false, reason: "dedup", existing_id: recentOcc[0].id };
      }

      // Build full conversation context for AI analysis (include both inbound AND outbound)
      const grouped = ctx.variables["mensagens_agrupadas"] || "";
      const transcription = ctx.variables["transcricao"] || "";
      const iaReply = ctx.variables["ia_reply"] || "";
      const contextParts: string[] = [];
      if (grouped) contextParts.push(grouped);
      if (transcription) contextParts.push(`[Áudio transcrito] ${transcription}`);
      if (ctx.messageContent && !grouped) contextParts.push(ctx.messageContent);
      if (iaReply) contextParts.push(`[Resposta da IA] ${iaReply}`);

      // Also fetch recent conversation messages (inbound + outbound) for fuller context
      const { data: recentMsgs } = await supabase
        .from("messages")
        .select("direction, content, type, created_at")
        .eq("contact_id", ctx.contactId)
        .order("created_at", { ascending: false })
        .limit(10);
      
      if (recentMsgs && recentMsgs.length > 0) {
        const msgHistory = recentMsgs
          .reverse()
          .filter((m: any) => m.content && m.content.trim())
          .map((m: any) => `[${m.direction === "inbound" ? "Cliente" : "Atendente"}]: ${m.content}`)
          .join("\n");
        if (msgHistory) contextParts.push(`\n[Histórico da conversa]:\n${msgHistory}`);
      }

      const conversationContext = contextParts.join("\n").slice(0, 3500) || "";

      if (conversationContext.length < 5) {
        console.log("[OCCURRENCE] Skipping: no conversation context available");
        return { registered: false, reason: "no_context" };
      }

      // ── Use AI to analyze conversation and decide if we have enough info ──
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY) {
        console.error("[OCCURRENCE] No LOVABLE_API_KEY available");
        return { registered: false, reason: "no_ai_key" };
      }

      try {
        const extractPrompt = `Você é um analisador de conversas de atendimento da Nutricar Brasil (rede de mini mercados autônomos 24h).

Analise a conversa abaixo e extraia informações para registrar uma ocorrência de atendimento.

IMPORTANTE SOBRE LOJAS:
- A Nutricar Brasil possui MUITAS unidades e está sempre abrindo novas lojas.
- NÃO valide o nome da loja contra nenhuma lista. Aceite QUALQUER nome de loja/unidade/bairro que o cliente informar.
- Registre o nome exatamente como o cliente informou (ex: "Alphaville 10", "Alpha 10", "Barra Park", etc).
- Se o cliente não informou a loja, use "Não informada".

TIPOS DE OCORRÊNCIA (use exatamente estes valores):
- elogio (feedback positivo, elogios, agradecimentos, satisfação com atendimento ou produto)
- reclamacao (insatisfação geral, mau atendimento, problemas não cobertos por categorias específicas)
- furto (relato de furto, roubo, subtração de produtos, flagrante, suspeita de furto na loja)
- falta_produto (produto em falta, prateleira vazia, produto não encontrado, sem estoque)
- produto_vencido (produto vencido, data de validade expirada, produto estragado, impróprio para consumo)
- loja_suja (sujeira, falta de limpeza, higiene precária, chão sujo, banheiro sujo, mau cheiro)
- problema_pagamento (totem com defeito, cobrança indevida, cartão não passa, PIX não funcionou, valor cobrado errado, estorno, reembolso)
- loja_sem_energia (loja sem luz, sem energia, queda de energia, equipamentos desligados, geladeira desligada)
- acesso_bloqueado (reconhecimento facial falhou, porta não abre, acesso negado, cadastro com problema)
- sugestao (sugestões de produtos, melhorias, pedidos de novos itens, ideias)
- duvida (perguntas sobre funcionamento, horário, pagamento, PIX, como funciona a loja)
- outro (assunto não identificado ou que não se encaixa nas categorias acima)

PRIORIDADE:
- alta (furto, produto vencido, loja sem energia, cobrança indevida, acesso bloqueado, loja suja, problema urgente)
- normal (reclamações gerais, problemas de pagamento, falta de produto, dúvidas)
- baixa (elogios, sugestões, feedback positivo)

DADOS DO CONTATO:
- Nome no sistema: "${ctx.contactName || "Não informado"}"
- Telefone: ${ctx.contactPhone}

CONVERSA COMPLETA (inclui mensagens do cliente E respostas do atendente):
"${conversationContext.slice(0, 2500)}"

INSTRUÇÕES:
1. Extraia o NOME do cliente: verifique se ele se identificou na conversa. Se não, use o nome do sistema.
2. Extraia a LOJA/UNIDADE: verifique se mencionou qual loja, bairro ou referência indireta.
3. Extraia DETALHES ESPECÍFICOS conforme a categoria:
   - Pagamento/cobrança: data e horário da transação, forma de pagamento, valor cobrado, valor esperado
   - Produto vencido: nome do produto, data de validade (se informada)
   - Falta de produto: nome do produto procurado
   - Loja suja: qual área afetada (chão, banheiro, prateleiras)
   - Acesso bloqueado: tipo de acesso (facial, porta), se é cadastro novo ou antigo
   - Loja sem energia: desde quando, quais equipamentos afetados
   - Furto/divergência: quando aconteceu, o que foi relatado
4. Avalie se há informações SUFICIENTES para registrar (precisa ter pelo menos o motivo claro).
5. Crie um RESUMO DETALHADO incluindo TODOS os detalhes fornecidos pelo cliente: o que aconteceu, quando, onde, valores, produtos, etc.
6. ATENÇÃO: O cliente pode interpretar situações de forma diferente da realidade. Registre fielmente o RELATO do cliente sem fazer julgamentos.
7. Analise TODA a conversa (incluindo respostas do atendente) para extrair informações que o cliente pode ter fornecido em resposta a perguntas.

Responda APENAS com JSON válido:
{
  "ready": true/false,
  "reason": "motivo se não está pronto (ex: cliente só cumprimentou, falta identificar o problema)",
  "store_name": "nome exato da loja ou Não informada",
  "contact_name": "nome do cliente",
  "type": "tipo da ocorrência",
  "priority": "alta/normal/baixa",
  "transaction_date": "data e horário da transação se informados, ou null",
  "product_name": "nome do produto envolvido se aplicável, ou null",
  "payment_method": "forma de pagamento se informada, ou null",
  "amount": "valor mencionado se informado, ou null",
  "summary": "Resumo detalhado com TODAS as informações coletadas: problema, local, data/horário, produto, valores, detalhes específicos. Máximo 4 frases."
}

REGRAS PARA "ready":
- ready=false se: cliente apenas cumprimentou, mensagem genérica sem problema claro, ou tipo seria "outro" sem detalhes
- ready=false se: store_name é "Não informada" (o cliente PRECISA informar a loja/unidade)
- ready=false se: contact_name é vazio ou igual a "Não informado" (o cliente PRECISA se identificar pelo nome)
- ready=true SOMENTE se: (1) há um problema/feedback/dúvida clara, (2) o nome da loja foi mencionado na conversa, E (3) o nome do cliente foi informado
- IMPORTANTE: Analise TODA a conversa (incluindo mensagens anteriores e respostas do atendente). O cliente pode ter informado o nome da loja em uma mensagem anterior (inclusive por áudio transcrito) e o nome em outra. NÃO peça informações que já foram fornecidas em qualquer ponto da conversa.
- Se a informação foi dada em qualquer mensagem do histórico, considere-a como coletada.`;

        const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-lite",
            messages: [{ role: "user", content: extractPrompt }],
            max_tokens: 500,
            temperature: 0.1,
          }),
        });

        if (!resp.ok) {
          console.error(`[OCCURRENCE] AI request failed (${resp.status})`);
          return { registered: false, reason: "ai_error" };
        }

        const data = await resp.json();
        const reply = data.choices?.[0]?.message?.content?.trim() || "";
        const jsonMatch = reply.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.error("[OCCURRENCE] AI returned non-JSON:", reply.slice(0, 200));
          return { registered: false, reason: "ai_parse_error" };
        }

        const parsed = JSON.parse(jsonMatch[0]);

        // ── Check if AI says we have enough info to register ──
        if (!parsed.ready) {
          console.log(`[OCCURRENCE] Not ready to register: ${parsed.reason || "insufficient info"}`);
          return { registered: false, reason: parsed.reason || "not_ready", details: "AI determined insufficient information" };
        }

        // ── Hard validation: store_name and contact_name are MANDATORY ──
        const storeName = parsed.store_name || "Não informada";
        const contactName = parsed.contact_name || ctx.contactName || "";

        if (!storeName || storeName === "Não informada" || storeName.trim().length < 2) {
          console.log(`[OCCURRENCE] Not ready: store_name missing ("${storeName}")`);
          return { registered: false, reason: "store_name_missing", details: "Cliente não informou a loja/unidade" };
        }

        if (!contactName || contactName === "Não informado" || contactName.trim().length < 2) {
          console.log(`[OCCURRENCE] Not ready: contact_name missing ("${contactName}")`);
          return { registered: false, reason: "contact_name_missing", details: "Cliente não informou o nome" };
        }

        const validTypes = ["elogio", "reclamacao", "furto", "falta_produto", "produto_vencido", "loja_suja", "problema_pagamento", "loja_sem_energia", "acesso_bloqueado", "sugestao", "duvida", "outro"];
        const occType = validTypes.includes(parsed.type) ? parsed.type : defaultType;
        const occPriority = ["alta", "normal", "baixa"].includes(parsed.priority) ? parsed.priority : priority;
        // Build enriched description with all extracted details
        const descParts: string[] = [];
        if (parsed.summary) descParts.push(parsed.summary);
        if (parsed.transaction_date) descParts.push(`Data/horário: ${parsed.transaction_date}`);
        if (parsed.product_name) descParts.push(`Produto: ${parsed.product_name}`);
        if (parsed.payment_method) descParts.push(`Pagamento: ${parsed.payment_method}`);
        if (parsed.amount) descParts.push(`Valor: ${parsed.amount}`);
        const description = descParts.length > 0 ? descParts.join(" | ") : conversationContext.slice(0, 500);

        console.log(`[OCCURRENCE] Registering: store="${storeName}", type="${occType}", priority="${occPriority}", name="${contactName}"`);

        const { error: occErr } = await supabase.from("occurrences").insert({
          store_name: storeName,
          type: occType,
          description,
          contact_phone: ctx.contactPhone || null,
          contact_name: contactName || null,
          priority: occPriority,
          status: "aberto",
          created_by: ctx.userId || null,
        });

        if (occErr) {
          console.error("Failed to register occurrence:", occErr.message);
          throw new Error(`Erro ao registrar ocorrência: ${occErr.message}`);
        }

        console.log(`Occurrence registered successfully: type=${occType}, store=${storeName}, name=${contactName}`);
        return { registered: true, type: occType, store: storeName, contactName, priority: occPriority };

      } catch (e) {
        console.error("[OCCURRENCE] Error:", e);
        return { registered: false, reason: "error", error: e instanceof Error ? e.message : "unknown" };
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
      // ── HUMANIZED CONTEXT ENGINE (6 strategies) ──
      // ══════════════════════════════════════════════════════════

      // ── 1. CONVERSATION MEMORY: load broader history (15 msgs) ──
      const { data: recentInbound } = await supabase
        .from("messages")
        .select("direction, content, type, media_url, created_at")
        .eq("contact_id", ctx.contactId)
        .eq("direction", "inbound")
        .order("created_at", { ascending: false })
        .limit(10);

      const { data: recentOutbound } = await supabase
        .from("messages")
        .select("direction, content, type, created_at")
        .eq("contact_id", ctx.contactId)
        .eq("direction", "outbound")
        .order("created_at", { ascending: false })
        .limit(5);

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
        .select("score, priority, notes, status")
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
        productContext = "\n\n🚫 PREÇOS: Você NÃO tem acesso ao catálogo de produtos neste momento. Se o cliente perguntar sobre preço ou valor de qualquer produto, NUNCA invente um valor. Diga: 'Vou verificar o valor para você' ou peça para enviar uma foto do código de barras. JAMAIS cite valores como R$ 2,50, R$ 7,99 ou qualquer outro número sem dados reais.";
      }

      // ── 4. SENTIMENT ANALYSIS: detect emotional tone from message ──
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

      // ── 5. BUILD ENRICHED PROFILE CONTEXT ──
      const profileParts: string[] = [];
      if (contactProfile?.name && contactProfile.name !== "Não informado") profileParts.push(`Nome: ${contactProfile.name}`);
      if (contactProfile?.email) profileParts.push(`Email: ${contactProfile.email}`);
      if (contactProfile?.about) profileParts.push(`Sobre: ${contactProfile.about}`);
      if (contactTags.length > 0) profileParts.push(`Tags: ${contactTags.join(", ")}`);
      if (convMeta?.priority && convMeta.priority !== "normal") profileParts.push(`Prioridade: ${convMeta.priority}`);
      if (convMeta?.notes) profileParts.push(`Notas anteriores: ${convMeta.notes}`);
      if ((convMeta?.score ?? 0) > 0) profileParts.push(`Score: ${convMeta.score}`);

      const profileContext = profileParts.length > 0
        ? `\n\n👤 PERFIL DO CONTATO (dados já conhecidos — NÃO pergunte novamente o que já sabe):\n${profileParts.join("\n")}`
        : "";

      // ── 6. RESPONSE VARIATION INSTRUCTION ──
      const variationHint = `\n\n🎭 VARIAÇÃO DE RESPOSTAS:
- NÃO repita a mesma saudação. Varie entre: "Oi", "Olá", "Ei", usar só o nome, ou ir direto ao ponto.
- Se já cumprimentou antes nesta conversa, NÃO cumprimente de novo.
- Varie despedidas: "Qualquer coisa, estou aqui!", "Conta comigo!", "Precisando, é só chamar!", etc.
- Seja natural como uma pessoa real conversando, não como um bot.`;

      // ── Compose final enriched system prompt ──
      const enrichedSystemPrompt = systemPrompt + profileContext + productContext + sentimentHint + variationHint;

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
          if (m.direction === "inbound") {
            (ctx as any)._lastImageUrl = m.media_url;
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

      // ── PROGRESSIVE PROFILE: save name/store if detected in conversation ──
      // (runs async, doesn't block response)
      try {
        const allText = (groupedMessages || transcription || ctx.messageContent || "").toLowerCase();
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
          // Use vision-capable model when images are present, otherwise fastest model
          const hasImage = !!imageBase64;
          const lovableModel = hasImage ? "google/gemini-2.5-flash" : "google/gemini-3-flash-preview";
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
            reply = `Perfeito! Encontrei no catálogo:\n\n🛒 Produto: *${catalogProductName}*\n💰 Valor: *${catalogPriceFormatted}*\n\nSe quiser, já te envio a chave PIX para pagamento.`;
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

        // ── POST-REPLY: decide if we should resolve product from image before sending text ──
        const promisedToCheck = /verificar|vou checar|já te informo|vou consultar|deixa eu ver|momento.*valor/i.test(reply);
        const hasBarcodeMention = /código de barras|barcode|código.*barras|EAN|GTIN/i.test(reply) || /código de barras|barcode|EAN|GTIN/i.test(ctx.messageContent || "");
        const replyRequestsCatalogCheck = /preciso identificar o produto no cat[aá]logo/i.test(reply);
        const paymentContext = /\b(valor|preço|preco|pix|pagamento|pagar)\b/i.test(`${reply} ${ctx.messageContent} ${ctx.variables["mensagens_agrupadas"] || ""}`);
        const shouldRunPostReplyLookup =
          !!imageBase64 &&
          !!ctx.userId &&
          ctx.variables["produto_encontrado"] !== "true" &&
          (promisedToCheck || hasBarcodeMention || replyRequestsCatalogCheck || (ctx.messageType === "image" && paymentContext));
        const shouldHoldPrimaryReply = shouldRunPostReplyLookup && replyRequestsCatalogCheck;

        // Store IA reply as variable for downstream nodes (e.g. TTS with {{ia_reply}})
        ctx.variables["ia_reply"] = reply;

        // If this run came through audio transcription route, prioritize audio reply
        const cameFromAudioRoute = Object.prototype.hasOwnProperty.call(ctx.variables, "transcricao");
        if (cameFromAudioRoute) {
          const voiceId = d.voice_id || "EXAVITQu4vr4xnSDxMaL";
          const audioResult = await sendElevenLabsAudioFromText(supabase, ctx, reply, voiceId);
          if (audioResult.sent) {
            await sendPixKeyIfPaymentRelated(supabase, ctx);
            return { sent: true, model, reply: (reply || "").slice(0, 80), suppressed: true, delivery: "audio" };
          }
          console.log(`Audio reply fallback to text: ${audioResult.reason || "unknown_reason"}`);
        }

        // Only send as text if not suppressed and not waiting for image lookup follow-up
        if (!d.suppress_send && !shouldHoldPrimaryReply) {
          await sendWhatsAppMessage(supabase, ctx, reply);
        } else if (!d.suppress_send && shouldHoldPrimaryReply) {
          ctx.variables["_audit_reply_suppressed"] = `Resposta suprimida para aguardar lookup de imagem: "${reply.slice(0, 200)}"`;
          console.log(`[AUDIT] Primary reply suppressed at ${new Date().toISOString()} — waiting for barcode lookup`);
        }

        if (shouldRunPostReplyLookup) {
          console.log("[POST-LLM] Triggered image product lookup after reply");
          try {
            // Quick AI call to extract barcode number from the image
            const extractPrompt = `Analise esta imagem e extraia APENAS o número do código de barras visível. Responda SOMENTE com o número (dígitos), nada mais. Se não houver código de barras visível, responda "NENHUM". Se houver texto descrevendo um produto, inclua o nome do produto após o código separado por |. Formato: CODIGO|NOME_PRODUTO ou apenas CODIGO ou NENHUM`;
            
            const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
            if (LOVABLE_API_KEY) {
              const extractResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
                method: "POST",
                headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: "google/gemini-2.5-flash",
                  messages: [{
                    role: "user",
                    content: [
                      { type: "text", text: extractPrompt },
                      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
                    ],
                  }],
                  max_tokens: 100,
                  temperature: 0.1,
                }),
              });

              if (extractResp.ok) {
                const extractData = await extractResp.json();
                const extracted = (extractData.choices?.[0]?.message?.content?.trim() || "").replace(/\s+/g, " ");
                console.log(`[POST-LLM] Barcode extraction result: "${extracted}"`);

                if (extracted && extracted !== "NENHUM" && extracted.length > 3) {
                  // Parse barcode and optional product name
                  const parts = extracted.split("|").map((p: string) => p.trim());
                  const barcodeNum = parts[0].replace(/\D/g, "");
                  const productHint = parts[1] || "";
                  const searchQuery = barcodeNum || productHint;

                  if (searchQuery.length > 2) {
                    const { data: products } = await supabase.rpc("search_products", {
                      _user_id: ctx.userId,
                      _query: searchQuery,
                      _limit: 3,
                    });

                    if (products && products.length > 0) {
                      const first = products[0];
                      ctx.variables["produto_encontrado"] = "true";
                      ctx.variables["produto_nome"] = first.name || "";
                      ctx.variables["produto_preco"] = String(first.price || 0);
                      const prodPrice = Number(first.price).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

                      const followUp = buildPixPaymentMessage(first.name || "", first.price);
                      ctx.variables["_pix_key_sent"] = "true";
                      ctx.variables["_audit_pix_auto_sent"] = `PIX enviado automaticamente via barcode lookup: ${first.name} = ${prodPrice} (código: ${searchQuery})`;
                      await sendWhatsAppMessage(supabase, ctx, followUp);
                      console.log(`[AUDIT] PIX key auto-sent at ${new Date().toISOString()} — product: ${first.name}, price: ${prodPrice}`);
                    } else {
                      // Product not in catalog
                      const notFound = `❌ Não encontrei esse produto no nosso catálogo${barcodeNum ? ` (código: ${barcodeNum})` : ""}. Poderia enviar outra foto mais nítida do código de barras ou me dizer o nome do produto?`;
                      await sendWhatsAppMessage(supabase, ctx, notFound);
                      console.log(`[POST-LLM] Product not found for: "${searchQuery}"`);
                    }
                  } else {
                    const notReadable = "⚠️ Não consegui ler o código de barras completo da foto. Pode enviar uma foto mais nítida, focando no código?";
                    await sendWhatsAppMessage(supabase, ctx, notReadable);
                    console.log(`[POST-LLM] Extracted content not usable for search: "${extracted}"`);
                  }
                } else {
                  const noBarcode = "⚠️ Não consegui identificar o código de barras nesta imagem. Pode reenviar com mais foco e iluminação?";
                  await sendWhatsAppMessage(supabase, ctx, noBarcode);
                  console.log("[POST-LLM] No readable barcode detected in image");
                }
              }
            }
          } catch (e) {
            console.error("[POST-LLM] Barcode extraction error:", e);
          }
        }

        // After replying, automatically send PIX key if the conversation is about payment
        await sendPixKeyIfPaymentRelated(supabase, ctx);
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
   - Leia o código de barras se visível (números)
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
  "barcode": "código de barras se visível ou null",
  "weight_volume": "peso ou volume se visível ou null",
  "category": "categoria estimada ou null",
  "confidence": 0-100,
  "description": "descrição breve do que foi visto na imagem",
  "suggestion": "sugestão para melhorar a foto se quality != boa, ou null"
}`,
        barcode_read: `Analise esta imagem e tente ler o código de barras (EAN-13, UPC, Code128, QR Code, etc.).
${customPrompt ? `INSTRUÇÃO: ${customPrompt}` : ""}
Responda com JSON: {"quality": "boa"|"ruim"|"parcial", "quality_issue": "...", "barcode": "números ou null", "barcode_type": "EAN-13|UPC|QR|outro", "confidence": 0-100, "identified": true/false, "product_name": null, "brand": null, "category": null, "description": "...", "suggestion": "..."}`,
        label_read: `Analise esta imagem e leia todas as informações do rótulo/etiqueta do produto (nome, ingredientes, validade, peso, preço, etc.).
${customPrompt ? `INSTRUÇÃO: ${customPrompt}` : ""}
Responda com JSON: {"quality": "boa"|"ruim"|"parcial", "quality_issue": "...", "identified": true/false, "product_name": "...", "brand": "...", "barcode": "...", "weight_volume": "...", "category": "...", "expiry_date": "...", "price_on_label": "...", "ingredients": "...", "confidence": 0-100, "description": "...", "suggestion": "..."}`,
        general: `Analise esta imagem e descreva detalhadamente o que você vê.
${customPrompt ? `INSTRUÇÃO: ${customPrompt}` : ""}
Responda com JSON: {"quality": "boa"|"ruim"|"parcial", "quality_issue": "...", "identified": false, "product_name": null, "brand": null, "barcode": null, "category": null, "confidence": 0-100, "description": "descrição detalhada", "suggestion": null}`,
      };

      const visionPrompt = analysisPrompts[analysisType] || analysisPrompts.product_identify;

      // Call Lovable AI with vision
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY) {
        console.error("[IMAGE ANALYSIS] No LOVABLE_API_KEY");
        return { analyzed: false, reason: "no_ai_key" };
      }

      let analysisResult: any = null;
      try {
        const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [{
              role: "user",
              content: [
                { type: "text", text: visionPrompt },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imgBase64}` } },
              ],
            }],
            max_tokens: 600,
            temperature: 0.2,
          }),
        });

        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(`Vision API error (${resp.status}): ${errText.slice(0, 200)}`);
        }

        const data = await resp.json();
        const reply = data.choices?.[0]?.message?.content?.trim() || "";
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
      if (searchCatalog && analysisResult.identified && ctx.userId) {
        try {
          const searchQuery = analysisResult.product_name || analysisResult.barcode || "";
          if (searchQuery.length > 2) {
            // Try barcode first if available
            if (analysisResult.barcode) {
              const { data: barcodeProducts } = await supabase.rpc("search_products", {
                _user_id: ctx.userId,
                _query: analysisResult.barcode,
                _limit: 3,
              });
              if (barcodeProducts?.length > 0) {
                catalogMatch = barcodeProducts.map((p: any) =>
                  `• ${p.name}${p.barcode ? ` (cód: ${p.barcode})` : ""}: *R$ ${Number(p.price).toFixed(2)}*${p.category ? ` [${p.category}]` : ""}`
                ).join("\n");
                ctx.variables["produto_preco"] = String(barcodeProducts[0].price);
                ctx.variables["produto_nome_catalogo"] = barcodeProducts[0].name;
              }
            }
            // Fallback to name search
            if (!catalogMatch && analysisResult.product_name) {
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
              }
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
            responseMsg += `\n\n⚠️ Este produto não foi encontrado no nosso catálogo. Vou verificar com a equipe!`;
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

      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY) {
        console.error("[VERIFY PAYMENT] No LOVABLE_API_KEY");
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
        const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [{
              role: "user",
              content: [
                { type: "text", text: visionPrompt },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imgBase64}` } },
              ],
            }],
            max_tokens: 800,
            temperature: 0.1,
          }),
        });

        if (!resp.ok) throw new Error(`Vision API error (${resp.status})`);
        const data = await resp.json();
        const reply = data.choices?.[0]?.message?.content?.trim() || "";
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

      // Also fetch the last 5 messages overall for broader context (regardless of time window)
      const { data: recentContextMsgs } = await supabase
        .from("messages")
        .select("content, type, media_url, created_at, direction")
        .eq("contact_id", ctx.contactId)
        .eq("direction", "inbound")
        .order("created_at", { ascending: false })
        .limit(5);

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

// ── Auto-send PIX key ONLY when customer reports DIFFICULTY paying ──
// Matches problems/failures with payment, NOT general payment mentions or inquiries
const PIX_DIFFICULTY_KEYWORDS = /\b(n[aã]o.*consig[ou].*pagar|n[aã]o.*passou|n[aã]o.*aceito[ua]?|n[aã]o.*funciono[ua]|problema.*pag|erro.*pag|pag.*erro|pag.*n[aã]o.*foi|cobran[cç]a.*indevid|valor.*cobrado.*errado|cobrou.*errado|cobrou.*mais|cobrou.*a\s*mais|cobrou.*diferente|estorno|reembolso|devolu[cç][aã]o|totem.*n[aã]o|totem.*com.*defeito|totem.*erro|totem.*travou|cart[aã]o.*recus|cart[aã]o.*n[aã]o|pix.*n[aã]o.*funciono|pix.*erro|pix.*problema|dificuldade.*pag|n[aã]o.*conseg.*pix)\b/i;
const PIX_KEY_MESSAGE = `💳 *Segue as opções de pagamento via PIX da Nutricar Brasil:*\n\n📧 *Chave PIX:* financeiro@nutricarbrasil.com.br\n\nApós o pagamento, envie o comprovante aqui pra gente confirmar! 😊\n_Nutricar Brasil - Mini Mercado 24h_`;

function buildPixPaymentMessage(productName?: string, productPrice?: string | number): string {
  const safeName = String(productName || "").trim();
  const numericPrice = Number(productPrice);
  const hasProduct = !!safeName;
  const hasPrice = Number.isFinite(numericPrice) && numericPrice > 0;

  if (hasProduct && hasPrice) {
    const priceFormatted = numericPrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    return `🛒 *Produto:* ${safeName}\n💰 *Valor:* ${priceFormatted}\n\n${PIX_KEY_MESSAGE}`;
  }

  return PIX_KEY_MESSAGE;
}

async function sendPixKeyIfPaymentRelated(supabase: any, ctx: ExecutionContext): Promise<boolean> {
  // Check if PIX was already sent in this execution
  if (ctx.variables["_pix_key_sent"] === "true") return false;

  // Check all available context for payment DIFFICULTY keywords (not general payment mentions)
  const allContext = [
    ctx.messageContent,
    ctx.variables["mensagens_agrupadas"] || "",
    ctx.variables["transcricao"] || "",
    ctx.variables["ia_reply"] || "",
    ctx.variables["intencao"] || "",
  ].join(" ");

  if (!PIX_DIFFICULTY_KEYWORDS.test(allContext)) return false;

  // ── GUARD: PIX only after catalog-confirmed product (no LLM-only prices) ──
  const productIdentified = ctx.variables["produto_encontrado"] === "true";

  if (!productIdentified) {
    // Product not yet identified in catalog — do not send PIX key yet
    console.log(`[PIX] Payment difficulty detected but product NOT identified in catalog — holding PIX key`);
    return false;
  }

  // Mark as sent to avoid duplicates
  ctx.variables["_pix_key_sent"] = "true";

  const pixMessage = buildPixPaymentMessage(ctx.variables["produto_nome"], ctx.variables["produto_preco"]);

  ctx.variables["_audit_pix_auto_sent"] = `PIX enviado via dificuldade de pagamento: produto=${ctx.variables["produto_nome"] || "N/A"}, valor=${ctx.variables["produto_preco"] || "N/A"}`;
  console.log(`[AUDIT] PIX key auto-sent (difficulty) at ${new Date().toISOString()} — ${ctx.contactPhone}`);
  await sendWhatsAppMessage(supabase, ctx, pixMessage);
  return true;
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

// ── Normalize numbers for better TTS pronunciation ──
function normalizeNumbersForTTS(text: string): string {
  if (!text) return text;

  const numberWords: Record<number, string> = {
    0: "zero", 1: "um", 2: "dois", 3: "três", 4: "quatro",
    5: "cinco", 6: "seis", 7: "sete", 8: "oito", 9: "nove",
    10: "dez", 11: "onze", 12: "doze", 13: "treze", 14: "quatorze",
    15: "quinze", 16: "dezesseis", 17: "dezessete", 18: "dezoito", 19: "dezenove",
    20: "vinte", 30: "trinta", 40: "quarenta", 50: "cinquenta",
    60: "sessenta", 70: "setenta", 80: "oitenta", 90: "noventa",
    100: "cem", 200: "duzentos", 300: "trezentos", 400: "quatrocentos",
    500: "quinhentos", 600: "seiscentos", 700: "setecentos", 800: "oitocentos",
    900: "novecentos", 1000: "mil",
  };

  function numberToWords(n: number): string {
    if (n < 0) return "menos " + numberToWords(-n);
    if (n <= 20) return numberWords[n] || String(n);
    if (n < 100) {
      const tens = Math.floor(n / 10) * 10;
      const units = n % 10;
      return units === 0 ? numberWords[tens] : `${numberWords[tens]} e ${numberWords[units]}`;
    }
    if (n === 100) return "cem";
    if (n < 200) return `cento e ${numberToWords(n - 100)}`;
    if (n < 1000) {
      const hundreds = Math.floor(n / 100) * 100;
      const remainder = n % 100;
      return remainder === 0 ? numberWords[hundreds] : `${numberWords[hundreds]} e ${numberToWords(remainder)}`;
    }
    if (n === 1000) return "mil";
    if (n < 2000) {
      const remainder = n % 1000;
      return remainder === 0 ? "mil" : `mil e ${numberToWords(remainder)}`;
    }
    if (n < 1000000) {
      const thousands = Math.floor(n / 1000);
      const remainder = n % 1000;
      const thousandStr = thousands === 1 ? "mil" : `${numberToWords(thousands)} mil`;
      return remainder === 0 ? thousandStr : `${thousandStr} e ${numberToWords(remainder)}`;
    }
    return String(n); // Fallback for very large numbers
  }

  // Replace standalone numbers (1-999999) but NOT inside URLs, dates (dd/mm), phone numbers, or IDs
  return text.replace(/(?<![\/\d\w.:-])(\d{1,6})(?![\/\d\w.:-])/g, (match) => {
    const num = parseInt(match);
    if (isNaN(num) || num > 999999) return match;
    return numberToWords(num);
  });
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
  let userModel = "eleven_multilingual_v2";
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
          stability: elConfig.stability ?? 0.5,
          similarity_boost: elConfig.similarityBoost ?? 0.75,
          style: elConfig.style ?? 0,
          use_speaker_boost: elConfig.useSpeakerBoost ?? true,
          speed: elConfig.speed ?? 1.0,
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
  if (voiceSettings) {
    ttsBody.voice_settings = voiceSettings;
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
