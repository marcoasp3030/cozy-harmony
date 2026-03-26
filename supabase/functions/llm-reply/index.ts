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

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = user.id;

    const { messages, provider, model, mode } = await req.json();
    // mode: "reply" (suggest reply), "summarize", "translate"

    // Load user's API keys from settings
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

    // Determine which provider to use
    const selectedProvider = provider || (keys.openai ? "openai" : keys.gemini ? "gemini" : null);
    if (!selectedProvider || !keys[selectedProvider]) {
      return new Response(
        JSON.stringify({ error: "Nenhuma API Key configurada. Vá em Configurações → API LLM para adicionar." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build system prompt based on mode
    let systemPrompt = "";
    switch (mode) {
      case "summarize":
        systemPrompt = "Você é um assistente. Resuma a conversa abaixo de forma concisa em português brasileiro, destacando os pontos principais.";
        break;
      case "translate":
        systemPrompt = "Você é um tradutor. Traduza a última mensagem do cliente para português brasileiro. Se já estiver em português, traduza para inglês.";
        break;
      default: // reply
        systemPrompt = `Você é uma atendente real da empresa — NÃO um robô. Responda como uma pessoa REAL no WhatsApp.

REGRA NÚMERO 1 — BREVIDADE ABSOLUTA:
- MÁXIMO 1-2 frases. NUNCA mais que 2 frases.
- Se consegue dizer em 5 palavras, NÃO use 15.
- Exemplo BOM: "Vou verificar e te retorno 👍"
- Exemplo RUIM: "Obrigada por nos avisar sobre a falta de produtos na loja. Vou encaminhar essa informação para a equipe responsável pelo abastecimento, para que eles possam resolver isso o mais rápido possível."

TOM:
- Informal e direto, mas com ORTOGRAFIA COMPLETA.
- NUNCA use abreviações: escreva "você" (não "vc"), "está" (não "tá"), "estou" (não "tô"), "para" (não "pra"), "não é" (não "né"), "também" (não "tb"), "muito" (não "mt"), "mesmo" (não "msm").
- Máximo 1-2 emojis por mensagem: 😊💚👍
- Fale como colega de trabalho, não como SAC.

PROIBIDO (se usar qualquer uma dessas, a resposta é INVÁLIDA):
- "Como posso ajudá-lo?" ou qualquer variação
- "Fico à disposição" / "Estou aqui" / "Estou à disposição"
- "Qualquer coisa, estou aqui" / "Qualquer dúvida"
- "A sua colaboração é importante" / "Agradecemos o contato"
- "prezado", "senhor(a)", "informamos que"
- Frases que começam com "Obrigada por nos avisar" / "Obrigado por informar"
- Qualquer frase genérica de chatbot/SAC
- Nunca invente informações que não estejam no histórico
- Nunca repita a pergunta do cliente

OTIMIZAÇÃO PARA VOZ (TTS):
- Valores monetários POR EXTENSO: "cento e cinquenta reais" em vez de "R$ 150,00"
- Números por extenso: "três dias" em vez de "3 dias"
- Evite siglas. NÃO use listas, marcadores, markdown ou formatação.
- Frases de tamanho médio (8-15 palavras).
- Escreva TODAS as palavras por EXTENSO — esta resposta pode ser convertida em áudio.

RETORNE APENAS o texto da resposta, sem aspas, sem explicações. MÁXIMO 2 FRASES.`;
    }

    // Format messages for API
    const chatMessages = [
      { role: "system", content: systemPrompt },
      ...messages.map((m: { direction: string; content: string; type?: string }) => ({
        role: m.direction === "inbound" ? "user" : "assistant",
        content: m.content || "[mídia]",
      })),
    ];

    if (mode === "reply") {
      chatMessages.push({ role: "user", content: "Sugira uma resposta adequada para a última mensagem do cliente." });
    } else if (mode === "summarize") {
      chatMessages.push({ role: "user", content: "Resuma esta conversa." });
    }

    let reply = "";

    if (selectedProvider === "openai") {
      const selectedModel = model || "gpt-4o-mini";
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${keys.openai}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: chatMessages,
          max_tokens: 500,
          temperature: 0.7,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error("OpenAI error:", resp.status, errText);
        return new Response(
          JSON.stringify({ error: `Erro na API OpenAI (${resp.status}). Verifique sua API Key.` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await resp.json();
      reply = data.choices?.[0]?.message?.content?.trim() || "";
    } else {
      // Gemini
      const selectedModel = model || "gemini-2.5-flash";
      // Convert to Gemini format
      const geminiContents = [];
      let systemText = systemPrompt;
      
      for (const msg of chatMessages) {
        if (msg.role === "system") continue;
        geminiContents.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        });
      }

      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${keys.gemini}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemText }] },
            contents: geminiContents,
            generationConfig: {
              maxOutputTokens: 500,
              temperature: 0.7,
            },
          }),
        }
      );

      if (!resp.ok) {
        const errText = await resp.text();
        console.error("Gemini error:", resp.status, errText);
        return new Response(
          JSON.stringify({ error: `Erro na API Gemini (${resp.status}). Verifique sua API Key.` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await resp.json();
      reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    }

    return new Response(
      JSON.stringify({ reply, provider: selectedProvider, model: model || (selectedProvider === "openai" ? "gpt-4o-mini" : "gemini-2.5-flash") }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("llm-reply error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
