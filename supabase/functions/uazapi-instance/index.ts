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
      Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const userId = claimsData.claims.sub as string;

    const { action } = await req.json();

    // Get user's UazAPI settings from DB
    const { data: settings } = await supabase
      .from('settings')
      .select('value')
      .eq('user_id', userId)
      .eq('key', 'uazapi_config')
      .single();

    if (!settings?.value) {
      return new Response(JSON.stringify({ error: 'UazAPI não configurada. Salve as configurações primeiro.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const config = settings.value as { baseUrl: string; adminToken: string; instanceToken: string };

    if (!config.baseUrl || !config.instanceToken) {
      return new Response(JSON.stringify({ error: 'URL e Instance Token são obrigatórios.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Normalize base URL
    const baseUrl = config.baseUrl.replace(/\/+$/, '');

    if (action === 'test') {
      // Test connection by checking instance status
      const res = await fetch(`${baseUrl}/instance/status`, {
        headers: { 'Authorization': `Bearer ${config.instanceToken}` },
      });
      const data = await res.json();

      if (!res.ok) {
        return new Response(JSON.stringify({ connected: false, error: `API retornou status ${res.status}` }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ connected: true, ...data }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (action === 'qrcode') {
      // Get QR code for connection
      const res = await fetch(`${baseUrl}/instance/qrcode`, {
        headers: { 'Authorization': `Bearer ${config.instanceToken}` },
      });
      const data = await res.json();

      return new Response(JSON.stringify(data), {
        status: res.ok ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (action === 'connect') {
      // Connect instance (generates QR)
      const res = await fetch(`${baseUrl}/instance/connect`, {
        headers: { 'Authorization': `Bearer ${config.instanceToken}` },
      });
      const data = await res.json();

      return new Response(JSON.stringify(data), {
        status: res.ok ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (action === 'disconnect') {
      const res = await fetch(`${baseUrl}/instance/disconnect`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.instanceToken}`,
          'Content-Type': 'application/json',
        },
      });
      const data = await res.json();

      return new Response(JSON.stringify(data), {
        status: res.ok ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else {
      return new Response(JSON.stringify({ error: 'Ação inválida. Use: test, qrcode, connect, disconnect' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('uazapi-instance error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
