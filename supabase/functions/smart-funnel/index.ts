import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const SYSTEM_PROMPT_TEMPLATE = (stageNames: string, currentStageName: string) =>
  `Você é um classificador de intenções para um funil de atendimento.
Analise a mensagem do cliente e sugira a melhor etapa do funil.

Etapas disponíveis:
${stageNames}

Etapa atual: ${currentStageName}

Responda APENAS com um JSON válido:
{
  "intent": "interesse|duvida|reclamacao|compra|cancelamento|suporte|neutro",
  "suggested_stage_index": <número da posição (0-based)>,
  "confidence": <0.0 a 1.0>,
  "reason": "<motivo breve em português>"
}

Se não houver motivo claro para mover, retorne a etapa atual e confidence baixa.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const authHeader = req.headers.get("Authorization");
    const { conversation_id, message_content, contact_name, provider: requestedProvider, model: requestedModel } = await req.json();

    if (!conversation_id || !message_content) {
      return json({ error: "Missing conversation_id or message_content" }, 400);
    }

    // ── Resolve user keys ────────────────────────────────────
    const keys: Record<string, string> = {};
    let userId = '';

    if (authHeader?.startsWith("Bearer ")) {
      const anonClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const token = authHeader.replace("Bearer ", "");
      const { data: claimsData } = await anonClient.auth.getClaims(token);
      userId = (claimsData?.claims?.sub as string) || '';

      if (userId) {
        const { data: settings } = await supabase
          .from('settings')
          .select('key, value')
          .eq('user_id', userId)
          .in('key', ['llm_openai', 'llm_gemini']);

        for (const s of settings || []) {
          const val = s.value as { apiKey?: string };
          if (s.key === 'llm_openai' && val?.apiKey) keys.openai = val.apiKey;
          if (s.key === 'llm_gemini' && val?.apiKey) keys.gemini = val.apiKey;
        }
      }
    }

    // Determine provider
    const provider = requestedProvider || (keys.openai ? 'openai' : keys.gemini ? 'gemini' : null);
    if (!provider || !keys[provider]) {
      return json({ error: `API Key do provedor ${provider || 'LLM'} não configurada. Vá em Configurações → API LLM.` }, 400);
    }

    // ── Get conversation + stages ────────────────────────────
    const { data: conv } = await supabase
      .from('conversations')
      .select('id, funnel_id, funnel_stage_id, score, status')
      .eq('id', conversation_id)
      .single();

    if (!conv?.funnel_id) return json({ suggestion: null, reason: "Conversa sem funil atribuído" });

    const { data: stages } = await supabase
      .from('funnel_stages')
      .select('id, name, position, color, score_threshold')
      .eq('funnel_id', conv.funnel_id)
      .order('position');

    if (!stages || stages.length === 0) return json({ suggestion: null, reason: "Funil sem etapas" });

    const currentStage = stages.find(s => s.id === conv.funnel_stage_id);
    const stageNames = stages.map(s => `${s.position + 1}. ${s.name}`).join('\n');
    const systemPrompt = SYSTEM_PROMPT_TEMPLATE(stageNames, currentStage?.name || 'Nenhuma');
    const userPrompt = `Cliente "${contact_name || 'desconhecido'}" disse: "${message_content}"`;

    // ── Call AI ──────────────────────────────────────────────
    let aiContent = '';

    if (provider === 'openai') {
      const model = requestedModel || 'gpt-4o-mini';
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${keys.openai}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: 200,
        }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        console.error("OpenAI error:", resp.status, errText);
        throw new Error(`OpenAI error: ${resp.status}`);
      }
      const data = await resp.json();
      aiContent = data.choices?.[0]?.message?.content?.trim() || '';
    } else {
      // Gemini
      const model = requestedModel || 'gemini-2.5-flash';
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${keys.gemini}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            generationConfig: { maxOutputTokens: 200, temperature: 0.2 },
          }),
        }
      );
      if (!resp.ok) {
        const errText = await resp.text();
        console.error("Gemini error:", resp.status, errText);
        throw new Error(`Gemini error: ${resp.status}`);
      }
      const data = await resp.json();
      aiContent = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    }

    // ── Parse response ───────────────────────────────────────
    let parsed;
    try {
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch?.[0] || aiContent);
    } catch {
      console.error("Failed to parse AI response:", aiContent);
      return json({ suggestion: null, reason: "Não foi possível classificar" });
    }

    const suggestedStage = stages[parsed.suggested_stage_index] || null;
    const shouldMove = suggestedStage &&
      suggestedStage.id !== conv.funnel_stage_id &&
      parsed.confidence >= 0.7;

    return json({
      suggestion: shouldMove ? {
        stage_id: suggestedStage.id,
        stage_name: suggestedStage.name,
        stage_color: suggestedStage.color,
      } : null,
      intent: parsed.intent,
      confidence: parsed.confidence,
      reason: parsed.reason,
      current_stage: currentStage?.name || null,
      provider,
    });

  } catch (e) {
    console.error("smart-funnel error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
