import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { conversation_id, message_content, contact_name } = await req.json();

    if (!conversation_id || !message_content) {
      return new Response(JSON.stringify({ error: "Missing conversation_id or message_content" }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get conversation with funnel info
    const { data: conv } = await supabase
      .from('conversations')
      .select('id, funnel_id, funnel_stage_id, score, status')
      .eq('id', conversation_id)
      .single();

    if (!conv?.funnel_id) {
      return new Response(JSON.stringify({ suggestion: null, reason: "Conversa sem funil atribuído" }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get funnel stages
    const { data: stages } = await supabase
      .from('funnel_stages')
      .select('id, name, position, color, score_threshold')
      .eq('funnel_id', conv.funnel_id)
      .order('position');

    if (!stages || stages.length === 0) {
      return new Response(JSON.stringify({ suggestion: null, reason: "Funil sem etapas" }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const currentStage = stages.find(s => s.id === conv.funnel_stage_id);
    const stageNames = stages.map(s => `${s.position + 1}. ${s.name}`).join('\n');

    // Use Lovable AI to classify intent
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: `Você é um classificador de intenções para um funil de atendimento.
Analise a mensagem do cliente e sugira a melhor etapa do funil.

Etapas disponíveis:
${stageNames}

Etapa atual: ${currentStage?.name || 'Nenhuma'}

Responda APENAS com um JSON válido:
{
  "intent": "interesse|duvida|reclamacao|compra|cancelamento|suporte|neutro",
  "suggested_stage_index": <número da posição (0-based)>,
  "confidence": <0.0 a 1.0>,
  "reason": "<motivo breve em português>"
}

Se não houver motivo claro para mover, retorne a etapa atual e confidence baixa.`
          },
          {
            role: "user",
            content: `Cliente "${contact_name || 'desconhecido'}" disse: "${message_content}"`
          }
        ],
        temperature: 0.2,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      throw new Error(`AI error: ${response.status}`);
    }

    const aiData = await response.json();
    const aiContent = aiData.choices?.[0]?.message?.content?.trim() || '';
    
    // Parse AI response
    let parsed;
    try {
      // Extract JSON from potential markdown code blocks
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch?.[0] || aiContent);
    } catch {
      console.error("Failed to parse AI response:", aiContent);
      return new Response(JSON.stringify({ suggestion: null, reason: "Não foi possível classificar" }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const suggestedStage = stages[parsed.suggested_stage_index] || null;
    const shouldMove = suggestedStage && 
      suggestedStage.id !== conv.funnel_stage_id && 
      parsed.confidence >= 0.7;

    return new Response(JSON.stringify({
      suggestion: shouldMove ? {
        stage_id: suggestedStage.id,
        stage_name: suggestedStage.name,
        stage_color: suggestedStage.color,
      } : null,
      intent: parsed.intent,
      confidence: parsed.confidence,
      reason: parsed.reason,
      current_stage: currentStage?.name || null,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (e) {
    console.error("smart-funnel error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
