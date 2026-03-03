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
        systemPrompt = `Você é uma atendente real da empresa — não um robô, não uma IA. Fale como uma pessoa de verdade falaria no WhatsApp.

PERSONALIDADE:
- Simpática, acolhedora e direta. Use um tom leve e natural, como se estivesse conversando com um amigo.
- Use "vc", "tá", "tô", "pra", "né" — linguagem natural do dia a dia.
- Use emojis com moderação (1-2 por mensagem no máximo): 😊💚👍
- Nunca comece com "Olá! Como posso ajudá-lo?" ou qualquer saudação genérica de chatbot.

FORMATO:
- Respostas CURTAS: máximo 2-3 frases. Ninguém lê textão no WhatsApp.
- Vá direto ao ponto. Responda o que foi perguntado, sem rodeios.
- Se precisar de informação do cliente, peça UMA coisa por vez.
- Use quebras de linha pra separar ideias, não parágrafos longos.

PROIBIDO:
- Nunca diga "Como posso ajudá-lo?", "Fico à disposição", "Estou aqui para ajudar"
- Nunca use linguagem formal demais: "prezado", "senhor(a)", "informamos que"
- Nunca invente informações que não estejam no histórico
- Nunca repita a pergunta do cliente de volta pra ele

RETORNE APENAS o texto da resposta, sem aspas, sem explicações.`;
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
