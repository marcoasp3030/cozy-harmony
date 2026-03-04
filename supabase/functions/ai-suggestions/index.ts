import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Helper: call AI using user's own OpenAI/Gemini keys ──
async function callUserAI(
  keys: Record<string, string>,
  messages: Array<{ role: string; content: string }>,
  options: { maxTokens?: number; temperature?: number; tools?: any[]; tool_choice?: any } = {}
): Promise<{ content?: string; tool_calls?: any[]; error?: string }> {
  const { maxTokens = 500, temperature = 0.7, tools, tool_choice } = options;
  const provider = keys.openai ? "openai" : keys.gemini ? "gemini" : null;
  if (!provider) return { error: "Nenhuma API Key configurada (OpenAI/Gemini). Vá em Configurações → API LLM." };

  try {
    if (provider === "openai") {
      const body: any = {
        model: "gpt-4o-mini",
        messages,
        max_tokens: maxTokens,
        temperature,
      };
      if (tools) body.tools = tools;
      if (tool_choice) body.tool_choice = tool_choice;

      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${keys.openai}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        console.error("OpenAI error:", resp.status, errText);
        return { error: `Erro na API OpenAI (${resp.status}). Verifique sua API Key.` };
      }
      const data = await resp.json();
      const choice = data.choices?.[0]?.message;
      return { content: choice?.content?.trim() || "", tool_calls: choice?.tool_calls };
    } else {
      // Gemini — convert messages to Gemini format
      const systemMsg = messages.find(m => m.role === "system");
      const geminiContents = messages
        .filter(m => m.role !== "system")
        .map(m => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        }));

      const body: any = {
        contents: geminiContents,
        generationConfig: { maxOutputTokens: maxTokens, temperature },
      };
      if (systemMsg) body.system_instruction = { parts: [{ text: systemMsg.content }] };

      // Gemini doesn't support OpenAI-style tool_choice, but supports tools
      if (tools) {
        body.tools = [{
          function_declarations: tools.map((t: any) => ({
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
          })),
        }];
        body.tool_config = { function_calling_config: { mode: "ANY" } };
      }

      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keys.gemini}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!resp.ok) {
        const errText = await resp.text();
        console.error("Gemini error:", resp.status, errText);
        return { error: `Erro na API Gemini (${resp.status}). Verifique sua API Key.` };
      }
      const data = await resp.json();
      const candidate = data.candidates?.[0]?.content;
      const textPart = candidate?.parts?.find((p: any) => p.text);
      const funcPart = candidate?.parts?.find((p: any) => p.functionCall);

      if (funcPart?.functionCall) {
        // Convert Gemini function call to OpenAI tool_calls format
        return {
          tool_calls: [{
            function: {
              name: funcPart.functionCall.name,
              arguments: JSON.stringify(funcPart.functionCall.args),
            },
          }],
        };
      }
      return { content: textPart?.text?.trim() || "" };
    }
  } catch (e) {
    console.error("AI call error:", e);
    return { error: e instanceof Error ? e.message : "Erro desconhecido na chamada de IA" };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { conversation_id, contact_id } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Resolve user from auth header
    const authHeader = req.headers.get("Authorization");
    let userId = "";
    if (authHeader?.startsWith("Bearer ")) {
      const anonClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const token = authHeader.replace("Bearer ", "");
      const { data: claimsData } = await anonClient.auth.getClaims(token);
      userId = (claimsData?.claims?.sub as string) || "";
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    if (!keys.openai && !keys.gemini) {
      return new Response(
        JSON.stringify({ error: "Nenhuma API Key configurada. Vá em Configurações → API LLM para adicionar." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load contact info
    const { data: contact } = await supabase
      .from("contacts")
      .select("name, phone, about, custom_fields, email")
      .eq("id", contact_id)
      .single();

    // Load contact tags
    const { data: tagLinks } = await supabase
      .from("contact_tags")
      .select("tag_id")
      .eq("contact_id", contact_id);
    
    let tags: string[] = [];
    if (tagLinks?.length) {
      const { data: tagRows } = await supabase
        .from("tags")
        .select("name")
        .in("id", tagLinks.map((t: any) => t.tag_id));
      tags = (tagRows || []).map((t: any) => t.name);
    }

    // Load last 30 messages for context
    const { data: msgs } = await supabase
      .from("messages")
      .select("direction, content, type, created_at")
      .eq("contact_id", contact_id)
      .order("created_at", { ascending: false })
      .limit(30);

    const messagesContext = (msgs || []).reverse().map((m: any) => ({
      role: m.direction === "inbound" ? "user" : "assistant",
      content: m.content || `[${m.type}]`,
    }));

    // Load conversation metadata
    const { data: conv } = await supabase
      .from("conversations")
      .select("status, priority, notes, score")
      .eq("id", conversation_id)
      .single();

    const contactContext = [
      contact?.name ? `Nome: ${contact.name}` : null,
      contact?.phone ? `Telefone: ${contact.phone}` : null,
      contact?.email ? `Email: ${contact.email}` : null,
      contact?.about ? `Sobre: ${contact.about}` : null,
      tags.length ? `Tags: ${tags.join(", ")}` : null,
      conv?.priority ? `Prioridade: ${conv.priority}` : null,
      conv?.notes ? `Notas: ${conv.notes}` : null,
      (conv?.score ?? 0) > 0 ? `Score: ${conv.score}` : null,
    ].filter(Boolean).join("\n");

    const systemPrompt = `Você é um assistente de atendimento ao cliente via WhatsApp. Sua tarefa é gerar EXATAMENTE 3 sugestões de resposta curtas e práticas para a última mensagem do cliente.

Contexto do contato:
${contactContext}

Regras:
- Gere 3 respostas diferentes: uma formal, uma amigável e uma objetiva
- Cada resposta deve ter no máximo 2 frases
- Use português brasileiro natural
- Não use saudações longas
- Considere o histórico da conversa e o perfil do contato
- Se o cliente fez uma pergunta, responda diretamente
- Se é uma reclamação, seja empático
- Se é um elogio, agradeça`;

    const tools = [{
      type: "function",
      function: {
        name: "suggest_replies",
        description: "Return exactly 3 reply suggestions",
        parameters: {
          type: "object",
          properties: {
            suggestions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string", description: "Short label: Formal, Amigável, or Objetiva" },
                  text: { type: "string", description: "The suggested reply text" },
                },
                required: ["label", "text"],
                additionalProperties: false,
              },
            },
          },
          required: ["suggestions"],
          additionalProperties: false,
        },
      },
    }];

    const result = await callUserAI(keys, [
      { role: "system", content: systemPrompt },
      ...messagesContext,
      { role: "user", content: "Gere 3 sugestões de resposta para a última mensagem do cliente." },
    ], {
      tools,
      tool_choice: { type: "function", function: { name: "suggest_replies" } },
    });

    if (result.error) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let suggestions = [];
    const toolCall = result.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        suggestions = parsed.suggestions || [];
      } catch {
        // If tool calling didn't work, try parsing content as JSON
        if (result.content) {
          try {
            const jsonMatch = result.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              suggestions = parsed.suggestions || [];
            }
          } catch {}
        }
      }
    } else if (result.content) {
      // Fallback: parse content as JSON (Gemini might return text instead of function call)
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          suggestions = parsed.suggestions || [];
        }
      } catch {}
    }

    return new Response(
      JSON.stringify({ suggestions }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("ai-suggestions error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
