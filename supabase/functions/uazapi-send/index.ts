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
      // Build interactive message payload for UazAPI
      endpoint = '/send/interactive';
      const interactivePayload: Record<string, unknown> = {};

      if (interactive.type === 'buttons') {
        interactivePayload.type = 'button';
        interactivePayload.body = { text: interactive.body || text || '' };
        if (interactive.header) interactivePayload.header = { type: 'text', text: interactive.header };
        if (interactive.footer) interactivePayload.footer = { text: interactive.footer };
        interactivePayload.action = {
          buttons: (interactive.buttons || []).slice(0, 3).map((btn: any, i: number) => ({
            type: 'reply',
            reply: { id: btn.id || String(i + 1), title: btn.title?.slice(0, 20) || `Opção ${i + 1}` },
          })),
        };
      } else if (interactive.type === 'list') {
        interactivePayload.type = 'list';
        interactivePayload.body = { text: interactive.body || text || '' };
        if (interactive.header) interactivePayload.header = { type: 'text', text: interactive.header };
        if (interactive.footer) interactivePayload.footer = { text: interactive.footer };
        interactivePayload.action = {
          button: interactive.listButtonText || 'Ver opções',
          sections: (interactive.listSections || []).map((section: any) => ({
            title: section.title,
            rows: (section.rows || []).map((row: any) => ({
              id: row.id,
              title: row.title?.slice(0, 24) || 'Item',
              description: row.description?.slice(0, 72) || undefined,
            })),
          })),
        };
      } else if (interactive.type === 'cta') {
        // CTA buttons (URL/phone) - use template-based approach or fallback to text with links
        interactivePayload.type = 'cta_url';
        interactivePayload.body = { text: interactive.body || text || '' };
        if (interactive.header) interactivePayload.header = { type: 'text', text: interactive.header };
        if (interactive.footer) interactivePayload.footer = { text: interactive.footer };
        interactivePayload.action = {
          buttons: (interactive.ctaButtons || []).map((btn: any) => ({
            type: btn.type === 'phone' ? 'phone_number' : 'url',
            ...(btn.type === 'phone'
              ? { phone_number: btn.value, title: btn.title }
              : { url: btn.value, title: btn.title }),
          })),
        };
      }

      sendBody.interactive = interactivePayload;
    } else if (type === 'poll' && interactive) {
      endpoint = '/send/poll';
      sendBody.name = interactive.pollName || 'Enquete';
      sendBody.options = (interactive.pollOptions || []).map((o: any) => o.title).filter(Boolean);
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
      return new Response(JSON.stringify({ success: false, error: `UazAPI retornou status ${res.status}`, details: data }), {
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
