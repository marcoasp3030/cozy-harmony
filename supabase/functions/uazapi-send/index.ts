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
    const { type, number, text, mediaUrl, caption, filename, delay } = body;

    if (!type || !number) {
      return new Response(JSON.stringify({ error: 'Campos "type" e "number" são obrigatórios.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate number format
    const cleanNumber = String(number).replace(/\D/g, '');
    if (cleanNumber.length < 10 || cleanNumber.length > 15) {
      return new Response(JSON.stringify({ error: 'Número de telefone inválido.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate type
    const validTypes = ['text', 'image', 'video', 'audio', 'document', 'ptt', 'sticker', 'contact', 'location'];
    if (!validTypes.includes(type)) {
      return new Response(JSON.stringify({ error: `Tipo inválido. Use: ${validTypes.join(', ')}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate text length
    if (type === 'text' && (!text || text.length > 4096)) {
      return new Response(JSON.stringify({ error: 'Texto é obrigatório e deve ter no máximo 4096 caracteres.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get UazAPI config
    const { data: settings } = await supabase
      .from('settings')
      .select('value')
      .eq('user_id', userId)
      .eq('key', 'uazapi_config')
      .single();

    if (!settings?.value) {
      return new Response(JSON.stringify({ error: 'UazAPI não configurada.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const config = settings.value as { baseUrl: string; instanceToken: string };
    const baseUrl = config.baseUrl.replace(/\/+$/, '');

    // Build request based on type
    // UazAPI v2: text uses /send/text, all media uses /send/media with type + file fields
    let endpoint: string;
    let sendBody: Record<string, unknown> = { number: cleanNumber };

    if (delay && Number(delay) > 0) sendBody.delay = Number(delay);

    if (type === 'text') {
      endpoint = '/send/text';
      sendBody.text = text;
    } else {
      endpoint = '/send/media';
      sendBody.type = type;
      sendBody.file = mediaUrl;
      if (caption) sendBody.caption = caption;
      if (type === 'document' && filename) sendBody.filename = filename;
    }

    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'token': config.instanceToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sendBody),
    });

    const data = await res.json();

    if (!res.ok) {
      return new Response(JSON.stringify({ success: false, error: `UazAPI retornou status ${res.status}`, details: data }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, ...data }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('uazapi-send error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
