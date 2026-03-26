import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: settings } = await supabase
      .from('settings')
      .select('value, user_id')
      .eq('key', 'inactivity_auto_close')
      .limit(10);

    if (!settings || settings.length === 0) {
      return json({ success: true, message: 'No inactivity settings configured', closed: 0 });
    }

    let totalClosed = 0;

    for (const setting of settings) {
      const config = setting.value as any;
      if (!config?.enabled || !config?.hours || config.hours < 1) continue;

      const thresholdDate = new Date(Date.now() - config.hours * 60 * 60 * 1000).toISOString();

      const { data: staleConversations } = await supabase
        .from('conversations')
        .select('id, contact_id, last_message_at')
        .eq('user_id', setting.user_id)
        .in('status', ['open', 'in_progress', 'waiting'])
        .lt('last_message_at', thresholdDate)
        .limit(100);

      if (!staleConversations || staleConversations.length === 0) continue;

      console.log(`Found ${staleConversations.length} stale conversations for user ${setting.user_id} (threshold: ${config.hours}h)`);

      // Get WhatsApp instance once per user
      const { data: instances } = await supabase
        .from('whatsapp_instances')
        .select('base_url, instance_token, is_default')
        .eq('user_id', setting.user_id)
        .limit(5);

      const instance = (instances || []).find((i: any) => i.is_default) || instances?.[0];
      const apiBase = instance?.base_url ? String(instance.base_url).replace(/\/+$/, '') : null;
      const token = instance?.instance_token || null;

      for (const conv of staleConversations) {
        if (!conv.contact_id) { totalClosed++; continue; }

        // Get contact info
        const { data: contact } = await supabase
          .from('contacts')
          .select('phone, name')
          .eq('id', conv.contact_id)
          .single();

        if (!contact?.phone || !apiBase || !token) {
          // Just close without messaging
          await supabase.from('conversations').update({ status: 'resolved', funnel_stage_id: null, funnel_id: null }).eq('id', conv.id);
          totalClosed++;
          continue;
        }

        const jid = contact.phone.includes('@') ? contact.phone : `${contact.phone}@s.whatsapp.net`;
        const contactName = contact.name || 'cliente';

        // ── STEP 1: Send satisfaction survey with interactive buttons ──
        const survey = config.survey;
        if (survey?.enabled && survey?.question && survey?.options?.length >= 2) {
          try {
            const surveyText = survey.question.replace(/\{\{nome\}\}/gi, contactName);
            const choices = survey.options
              .map((opt: any, idx: number) => {
                const title = (opt.label || `Opção ${idx + 1}`).slice(0, 20);
                const id = opt.value || `btn_${idx}`;
                return `${title}|${id}`;
              });

            const cleanNumber = String(contact.phone).replace(/\D/g, '');
            const menuPayload = {
              number: cleanNumber,
              type: 'button',
              text: surveyText,
              choices,
              footerText: 'Pesquisa de satisfação',
            };

            console.log(`Sending survey to ${contact.phone}:`, JSON.stringify(menuPayload).slice(0, 200));

            const surveyResp = await fetch(`${apiBase}/send/menu`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'token': token },
              body: JSON.stringify(menuPayload),
            });

            const surveyResult = await surveyResp.json().catch(() => ({}));
            console.log(`Survey send result (${surveyResp.status}):`, JSON.stringify(surveyResult).slice(0, 200));

            // Save survey message in DB
            await supabase.from('messages').insert({
              contact_id: conv.contact_id,
              direction: 'outbound',
              type: 'interactive',
              content: surveyText,
              status: 'sent',
              user_id: setting.user_id,
              metadata: {
                auto_close: true,
                survey: true,
                interactive: {
                  type: 'buttons',
                  body: surveyText,
                  buttons: survey.options,
                },
              },
            });
          } catch (surveyErr) {
            console.error(`Survey send error for conv ${conv.id}:`, surveyErr);
          }
        }

        // ── STEP 2: Send close message (after survey) ──
        if (config.closeMessage) {
          try {
            const closeText = config.closeMessage.replace(/\{\{nome\}\}/gi, contactName);

            await fetch(`${apiBase}/send/text`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'token': token },
              body: JSON.stringify({ phone: jid, message: closeText }),
            });

            await supabase.from('messages').insert({
              contact_id: conv.contact_id,
              direction: 'outbound',
              type: 'text',
              content: closeText,
              status: 'sent',
              user_id: setting.user_id,
              metadata: { auto_close: true },
            });

            console.log(`Sent close message to ${contact.phone} for conversation ${conv.id}`);
          } catch (sendErr) {
            console.error(`Failed to send close message for conv ${conv.id}:`, sendErr);
          }
        }

        // ── STEP 3: Generate conversation summary for long-term memory ──
        try {
          if (conv.contact_id) {
            // Load user's API keys
            const { data: llmSettings } = await supabase
              .from('settings')
              .select('key, value')
              .eq('user_id', setting.user_id)
              .in('key', ['llm_openai', 'llm_gemini']);

            const aiKeys: Record<string, string> = {};
            for (const s of llmSettings || []) {
              const val = s.value as any;
              if (s.key === 'llm_openai' && val?.apiKey) aiKeys.openai = val.apiKey;
              if (s.key === 'llm_gemini' && val?.apiKey) aiKeys.gemini = val.apiKey;
            }

            if (aiKeys.openai || aiKeys.gemini) {
              // Load last 30 messages from this conversation
              const { data: convMessages } = await supabase
                .from('messages')
                .select('direction, content, type, created_at')
                .eq('contact_id', conv.contact_id)
                .order('created_at', { ascending: false })
                .limit(30);

              if (convMessages && convMessages.length >= 3) {
                const msgHistory = convMessages
                  .reverse()
                  .filter((m: any) => m.content?.trim())
                  .map((m: any) => `[${m.direction === 'inbound' ? 'Cliente' : 'Atendente'}]: ${m.content}`)
                  .join('\n');

                // Load existing summary for context
                const { data: existingContact } = await supabase
                  .from('contacts')
                  .select('conversation_summary, name')
                  .eq('id', conv.contact_id)
                  .single();

                const existingSummary = existingContact?.conversation_summary || '';

                const summaryPrompt = `Você é um sistema de memória. Resuma a conversa abaixo em MAX 3 frases focando em: problema relatado, solução dada, preferências do cliente. Seja objetivo.
${existingSummary ? `\nRESUMO ANTERIOR:\n${existingSummary}\n\nATUALIZE o resumo incorporando novas informações:` : ''}

CONVERSA:
${msgHistory.slice(0, 3000)}

Responda APENAS o resumo atualizado (max 200 palavras).`;

                let summary = '';

                if (aiKeys.openai) {
                  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${aiKeys.openai}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      model: 'gpt-4o',
                      messages: [{ role: 'user', content: summaryPrompt }],
                      max_tokens: 300,
                      temperature: 0.2,
                    }),
                  });
                  if (resp.ok) {
                    const data = await resp.json();
                    summary = data.choices?.[0]?.message?.content?.trim() || '';
                  } else {
                    const errText = await resp.text();
                    console.error(`[MEMORY] OpenAI error (${resp.status}):`, errText.slice(0, 100));
                  }
                } else if (aiKeys.gemini) {
                  const resp = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${aiKeys.gemini}`,
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        contents: [{ role: 'user', parts: [{ text: summaryPrompt }] }],
                        generationConfig: { maxOutputTokens: 300, temperature: 0.2 },
                      }),
                    }
                  );
                  if (resp.ok) {
                    const data = await resp.json();
                    summary = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
                  } else {
                    const errText = await resp.text();
                    console.error(`[MEMORY] Gemini error (${resp.status}):`, errText.slice(0, 100));
                  }
                }

                if (summary) {
                  await supabase.from('contacts').update({ conversation_summary: summary }).eq('id', conv.contact_id);
                  console.log(`[MEMORY] Saved conversation summary for contact ${conv.contact_id}: "${summary.slice(0, 80)}"`);
                }
              }
            } else {
              console.log(`[MEMORY] No API keys configured for user ${setting.user_id}, skipping summary`);
            }
          }
        } catch (memErr) {
          console.error(`[MEMORY] Failed to generate summary for conv ${conv.id}:`, memErr);
        }

        // ── STEP 3.5: Register deferred occurrence if conversation was flagged ──
        try {
          // Check if this conversation has a pending_occurrence flag in notes
          const { data: convData } = await supabase
            .from('conversations')
            .select('notes')
            .eq('id', conv.id)
            .single();

          let pendingOccurrence: any = null;
          try {
            const notesObj = JSON.parse(convData?.notes || '{}');
            if (notesObj?.pending_occurrence) pendingOccurrence = notesObj;
          } catch {}

          if (pendingOccurrence) {
            console.log(`[OCCURRENCE-DEFERRED] Processing deferred occurrence for conv ${conv.id}`);

            // Dedup check — 2 hour window
            const dedupMinutes = 120;
            const dedupCutoff = new Date(Date.now() - dedupMinutes * 60 * 1000).toISOString();
            const { data: recentOcc } = await supabase
              .from('occurrences')
              .select('id, type, created_at')
              .eq('contact_phone', contact.phone)
              .gte('created_at', dedupCutoff)
              .order('created_at', { ascending: false })
              .limit(5);

            if (recentOcc && recentOcc.length > 0) {
              console.log(`[OCCURRENCE-DEFERRED] Dedup: skipping for ${contact.phone}, ${recentOcc.length} recent occurrences found`);
            } else {
              // Load FULL conversation messages for AI analysis
              const { data: allMessages } = await supabase
                .from('messages')
                .select('direction, content, type, created_at')
                .eq('contact_id', conv.contact_id)
                .order('created_at', { ascending: false })
                .limit(50);

              const conversationContext = (allMessages || [])
                .reverse()
                .filter((m: any) => m.content?.trim())
                .map((m: any) => `[${m.direction === 'inbound' ? 'Cliente' : 'Atendente'}]: ${m.content}`)
                .join('\n');

              if (conversationContext.length >= 10 && (aiKeys.openai || aiKeys.gemini)) {
                const extractPrompt = `Você é um analisador de conversas de atendimento da Nutricar Brasil (rede de mini mercados autônomos 24h).

Analise a conversa COMPLETA abaixo e extraia informações para registrar uma ocorrência.

IMPORTANTE: Esta é a conversa COMPLETA (já encerrada). Extraia TODAS as informações disponíveis.

TIPOS DE OCORRÊNCIA: elogio, reclamacao, furto, falta_produto, produto_vencido, loja_suja, problema_pagamento, loja_sem_energia, acesso_bloqueado, sugestao, duvida, outro

PRIORIDADE:
- alta (furto, produto vencido, loja sem energia, cobrança indevida, acesso bloqueado, loja suja)
- normal (reclamações gerais, problemas de pagamento, falta de produto, dúvidas)
- baixa (elogios, sugestões, feedback positivo)

DADOS DO CONTATO:
- Nome no sistema: "${contactName}"
- Telefone: ${contact.phone}

CONVERSA COMPLETA:
"${conversationContext.slice(0, 4000)}"

INSTRUÇÕES:
1. Extraia NOME do cliente (se se identificou na conversa, senão use o nome do sistema)
2. Extraia LOJA/UNIDADE mencionada
3. Extraia TODOS os detalhes: problema, data/horário, produto, valores, forma de pagamento
4. Se houve MÚLTIPLOS problemas, combine tudo no resumo
5. Se não há problema/feedback claro (apenas cumprimento, conversa genérica), retorne ready=false

Responda APENAS com JSON válido:
{
  "ready": true/false,
  "reason": "motivo se não está pronto",
  "store_name": "nome da loja ou Não informada",
  "contact_name": "nome do cliente",
  "type": "tipo da ocorrência",
  "priority": "alta/normal/baixa",
  "summary": "Resumo completo com TODOS os detalhes coletados durante toda a conversa. Max 5 frases."
}`;

                let aiReply = '';
                if (aiKeys.openai) {
                  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${aiKeys.openai}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      model: 'gpt-4o',
                      messages: [{ role: 'user', content: extractPrompt }],
                      max_tokens: 500,
                      temperature: 0.1,
                    }),
                  });
                  if (resp.ok) {
                    const data = await resp.json();
                    aiReply = data.choices?.[0]?.message?.content?.trim() || '';
                  }
                } else if (aiKeys.gemini) {
                  const resp = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${aiKeys.gemini}`,
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        contents: [{ role: 'user', parts: [{ text: extractPrompt }] }],
                        generationConfig: { maxOutputTokens: 500, temperature: 0.1 },
                      }),
                    }
                  );
                  if (resp.ok) {
                    const data = await resp.json();
                    aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
                  }
                }

                if (aiReply) {
                  const jsonMatch = aiReply.match(/\{[\s\S]*\}/);
                  if (jsonMatch) {
                    try {
                      const parsed = JSON.parse(jsonMatch[0]);
                      if (parsed.ready) {
                        const storeName = parsed.store_name || 'Não informada';
                        const occContactName = parsed.contact_name || contactName || '';
                        const validTypes = ['elogio', 'reclamacao', 'furto', 'falta_produto', 'produto_vencido', 'loja_suja', 'problema_pagamento', 'loja_sem_energia', 'acesso_bloqueado', 'sugestao', 'duvida', 'outro'];
                        const occType = validTypes.includes(parsed.type) ? parsed.type : (pendingOccurrence.default_type || 'reclamacao');
                        const occPriority = ['alta', 'normal', 'baixa'].includes(parsed.priority) ? parsed.priority : (pendingOccurrence.default_priority || 'normal');
                        const description = parsed.summary || conversationContext.slice(0, 500);

                        const { error: occErr } = await supabase.from('occurrences').insert({
                          store_name: storeName,
                          type: occType,
                          description,
                          contact_phone: contact.phone || null,
                          contact_name: occContactName || null,
                          priority: occPriority,
                          status: 'aberto',
                          created_by: setting.user_id || null,
                        });

                        if (occErr) {
                          console.error(`[OCCURRENCE-DEFERRED] Insert error:`, occErr.message);
                        } else {
                          console.log(`[OCCURRENCE-DEFERRED] Registered: store="${storeName}", type="${occType}", priority="${occPriority}", name="${occContactName}"`);

                          // Save condomínio on contact profile
                          if (storeName && storeName !== 'Não informada') {
                            try {
                              const { data: currentContact } = await supabase
                                .from('contacts')
                                .select('custom_fields')
                                .eq('id', conv.contact_id)
                                .single();
                              const existingFields = (currentContact?.custom_fields as Record<string, any>) || {};
                              if (!existingFields.condominio || existingFields.condominio !== storeName) {
                                await supabase.from('contacts').update({
                                  custom_fields: { ...existingFields, condominio: storeName },
                                }).eq('id', conv.contact_id);
                              }
                            } catch {}
                          }

                          // Save contact name if detected
                          if (occContactName && occContactName !== 'Não informado') {
                            try {
                              await supabase.from('contacts').update({ name: occContactName }).eq('id', conv.contact_id);
                            } catch {}
                          }
                        }
                      } else {
                        console.log(`[OCCURRENCE-DEFERRED] AI says not ready: ${parsed.reason || 'no clear issue'}`);
                      }
                    } catch (parseErr) {
                      console.error(`[OCCURRENCE-DEFERRED] JSON parse error:`, parseErr);
                    }
                  }
                }
              }
            }
          }
        } catch (occErr) {
          console.error(`[OCCURRENCE-DEFERRED] Error processing deferred occurrence for conv ${conv.id}:`, occErr);
        }

        // ── STEP 4: Close the conversation ──
        await supabase.from('conversations').update({
          status: 'resolved',
          funnel_stage_id: null,
          funnel_id: null,
          notes: null, // Clear the pending_occurrence flag
        }).eq('id', conv.id);

        totalClosed++;
      }
    }

    console.log(`Auto-close complete. Total closed: ${totalClosed}`);
    return json({ success: true, closed: totalClosed });
  } catch (err) {
    console.error('Auto-close error:', err);
    return json({ success: false, error: String(err) }, 500);
  }
});
