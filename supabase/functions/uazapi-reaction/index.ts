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

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const userId = user.id;
    const { messageExternalId, emoji, instanceId, number } = await req.json();

    if (!messageExternalId || !emoji) {
      return new Response(JSON.stringify({ error: 'messageExternalId e emoji são obrigatórios.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Resolve instance config
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
      const { data: instances } = await supabase
        .from('whatsapp_instances')
        .select('base_url, instance_token')
        .eq('user_id', userId)
        .order('is_default', { ascending: false })
        .limit(1);

      if (instances && instances.length > 0) {
        const inst = instances[0] as any;
        config = { baseUrl: inst.base_url, instanceToken: inst.instance_token };
      }
    }

    if (!config?.baseUrl || !config?.instanceToken) {
      return new Response(JSON.stringify({ error: 'UazAPI não configurada.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const baseUrl = config.baseUrl.replace(/\/+$/, '');

    console.log('Sending reaction:', { messageExternalId, emoji, number });

    const sendBody: Record<string, unknown> = {
      id: messageExternalId,
      reaction: emoji,
    };
    if (number) sendBody.number = String(number).replace(/\D/g, '');

    const res = await fetch(`${baseUrl}/message/react`, {
      method: 'POST',
      headers: { 'token': config.instanceToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(sendBody),
    });

    const data = await res.json();
    console.log('UazAPI reaction response:', JSON.stringify(data));

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
    console.error('uazapi-reaction error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
