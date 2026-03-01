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
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const { conversation_id, contact_id } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          ...messagesContext,
          { role: "user", content: "Gere 3 sugestões de resposta para a última mensagem do cliente." },
        ],
        tools: [{
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
        }],
        tool_choice: { type: "function", function: { name: "suggest_replies" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit excedido. Tente novamente em alguns segundos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos insuficientes. Adicione créditos ao workspace." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    
    let suggestions = [];
    if (toolCall?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        suggestions = parsed.suggestions || [];
      } catch {
        suggestions = [];
      }
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
