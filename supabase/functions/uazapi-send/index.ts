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

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const userId = claimsData.claims.sub as string;
    const body = await req.json();
    const { type, number, text, mediaUrl, caption, filename, delay, instanceId, interactive } = body;

    if (!type || !number) {
      return new Response(JSON.stringify({ error: 'Campos "type" e "number" são obrigatórios.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cleanNumber = String(number).replace(/\D/g, '');
    if (cleanNumber.length < 10 || cleanNumber.length > 15) {
      return new Response(JSON.stringify({ error: 'Número de telefone inválido.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const validTypes = ['text', 'image', 'video', 'audio', 'document', 'ptt', 'sticker', 'contact', 'location', 'interactive', 'poll'];
    if (!validTypes.includes(type)) {
      return new Response(JSON.stringify({ error: `Tipo inválido. Use: ${validTypes.join(', ')}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (type === 'text' && (!text || text.length > 4096)) {
      return new Response(JSON.stringify({ error: 'Texto é obrigatório e deve ter no máximo 4096 caracteres.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── RESOLVE CONFIG: whatsapp_instances table or legacy settings ──
    let config: { baseUrl: string; instanceToken: string } | null = null;

    if (instanceId) {
      const { data: inst } = await supabase
        .from('whatsapp_instances')
        .select('base_url, instance_token')
        .eq('id', instanceId)
        .eq('user_id', userId)
        .single();
      if (inst) config = { baseUrl: (inst as any).base_url, instanceToken: (inst as any).instance_token };
    }

    if (!config) {
      // Try default instance
      const { data: instances } = await supabase
        .from('whatsapp_instances')
        .select('base_url, instance_token')
        .eq('user_id', userId)
        .order('is_default', { ascending: false })
        .limit(1);

      if (instances && instances.length > 0) {
        const inst = instances[0] as any;
        config = { baseUrl: inst.base_url, instanceToken: inst.instance_token };
      } else {
        // Legacy fallback
        const { data: settings } = await supabase
          .from('settings')
          .select('value')
          .eq('user_id', userId)
          .eq('key', 'uazapi_config')
          .single();
        if (settings?.value) {
          const v = settings.value as any;
          config = { baseUrl: v.baseUrl, instanceToken: v.instanceToken };
        }
      }
    }

    if (!config?.baseUrl || !config?.instanceToken) {
      return new Response(JSON.stringify({ error: 'UazAPI não configurada.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const baseUrl = config.baseUrl.replace(/\/+$/, '');

    let endpoint: string;
    let sendBody: Record<string, unknown> = { number: cleanNumber };
    if (delay && Number(delay) > 0) sendBody.delay = Number(delay);

    if (type === 'text') {
      endpoint = '/send/text';
      sendBody.text = text;
    } else if (type === 'interactive' && interactive) {
      // Use UazAPI /send/menu endpoint for interactive messages
      endpoint = '/send/menu';

      if (interactive.type === 'buttons') {
        sendBody.type = 'button';
        sendBody.text = interactive.body || text || '';
        if (interactive.footer) sendBody.footerText = interactive.footer;
        sendBody.choices = (interactive.buttons || []).slice(0, 3).map((btn: any, i: number) => {
          const title = btn.title?.slice(0, 20) || `Opção ${i + 1}`;
          const id = btn.id || String(i + 1);
          return `${title}|${id}`;
        });
      } else if (interactive.type === 'list') {
        sendBody.type = 'list';
        sendBody.text = interactive.body || text || '';
        sendBody.listButton = interactive.listButtonText || 'Ver opções';
        if (interactive.footer) sendBody.footerText = interactive.footer;
        const choices: string[] = [];
        for (const section of (interactive.listSections || [])) {
          choices.push(`[${section.title}]`);
          for (const row of (section.rows || [])) {
            const title = row.title?.slice(0, 24) || 'Item';
            const id = row.id || title;
            const desc = row.description?.slice(0, 72) || '';
            choices.push(desc ? `${title}|${id}|${desc}` : `${title}|${id}`);
          }
        }
        sendBody.choices = choices;
      } else if (interactive.type === 'cta') {
        sendBody.type = 'button';
        sendBody.text = interactive.body || text || '';
        if (interactive.footer) sendBody.footerText = interactive.footer;
        sendBody.choices = (interactive.ctaButtons || []).map((btn: any) => {
          const title = btn.title || 'Link';
          if (btn.type === 'phone') return `${title}|call:${btn.value}`;
          return `${title}|${btn.value}`;
        });
      }
    } else if (type === 'poll' && interactive) {
      endpoint = '/send/menu';
      sendBody.type = 'poll';
      sendBody.text = interactive.pollName || 'Enquete';
      sendBody.choices = (interactive.pollOptions || []).map((o: any) => o.title).filter(Boolean);
      sendBody.selectableCount = interactive.pollMultiSelect ? 0 : 1;
    } else {
      endpoint = '/send/media';
      sendBody.type = type;
      sendBody.file = mediaUrl;
      if (caption) sendBody.caption = caption;
      if (type === 'document' && filename) sendBody.filename = filename;
    }

    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'token': config.instanceToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(sendBody),
    });

    const data = await res.json();

    if (!res.ok) {
      // ── Enqueue for retry on transient errors (5xx, timeouts, rate limits) ──
      const isRetryable = res.status >= 500 || res.status === 429 || res.status === 408;
      if (isRetryable) {
        try {
          const serviceClient = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
          );
          // Store the full payload + endpoint for replay
          const retryPayload = { ...sendBody, _endpoint: endpoint };
          await serviceClient.from('message_retry_queue').insert({
            user_id: userId,
            phone: cleanNumber,
            message_type: type,
            instance_id: instanceId || null,
            payload: retryPayload,
            next_retry_at: new Date(Date.now() + 30_000).toISOString(), // first retry in 30s
          });
          console.log(`[RETRY-ENQUEUE] Message to ${cleanNumber} queued for retry (HTTP ${res.status})`);
        } catch (retryErr) {
          console.error('[RETRY-ENQUEUE] Failed to enqueue:', retryErr);
        }
      }

      return new Response(JSON.stringify({ 
        success: false, 
        error: `UazAPI retornou status ${res.status}`, 
        details: data,
        retryQueued: isRetryable,
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, ...data }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('uazapi-send error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
