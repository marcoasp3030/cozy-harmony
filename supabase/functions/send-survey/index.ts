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

    // Get the user from the auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    const { contactPhone, contactName } = await req.json();
    if (!contactPhone) return json({ error: 'contactPhone is required' }, 400);

    // Load survey config
    const { data: settingsData } = await supabase
      .from('settings')
      .select('value')
      .eq('user_id', user.id)
      .eq('key', 'inactivity_auto_close')
      .single();

    const config = settingsData?.value as any;
    const survey = config?.survey;

    if (!survey?.enabled || !survey?.question || !survey?.options || survey.options.length < 2) {
      return json({ error: 'Pesquisa de satisfação não está configurada. Vá em Configurações > Inatividade para configurar.' }, 400);
    }

    // Get WhatsApp instance
    const { data: instances } = await supabase
      .from('whatsapp_instances')
      .select('base_url, instance_token, is_default')
      .eq('user_id', user.id)
      .limit(5);

    const instance = (instances || []).find((i: any) => i.is_default) || instances?.[0];
    const apiBase = instance?.base_url ? String(instance.base_url).replace(/\/+$/, '') : null;
    const instanceToken = instance?.instance_token || null;

    if (!apiBase || !instanceToken) {
      return json({ error: 'Nenhuma instância WhatsApp configurada' }, 400);
    }

    const cleanNumber = contactPhone.replace(/\D/g, '');
    const name = contactName || 'cliente';
    const surveyText = survey.question.replace(/\{\{nome\}\}/gi, name);
    
    // choices must be an ARRAY of "title|id" strings
    const choices = survey.options.map((opt: any, idx: number) => {
      const title = (opt.label || `Opção ${idx + 1}`).slice(0, 20);
      const id = opt.value || `btn_${idx}`;
      return `${title}|${id}`;
    });

    const menuPayload = {
      number: cleanNumber,
      type: 'button',
      text: surveyText,
      choices,
      footerText: 'Pesquisa de satisfação',
    };

    console.log(`Sending survey to ${contactPhone}, payload:`, JSON.stringify(menuPayload));

    const resp = await fetch(`${apiBase}/send/menu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'token': instanceToken },
      body: JSON.stringify(menuPayload),
    });

    const result = await resp.json().catch(() => ({}));
    console.log(`Menu result (${resp.status}):`, JSON.stringify(result).slice(0, 300));

    if (!resp.ok || result?.error) {
      return json({ error: 'Falha ao enviar pesquisa: ' + JSON.stringify(result), payload: menuPayload }, 400);
    }

    return json({ success: true, result });
  } catch (err) {
    console.error('Send survey error:', err);
    return json({ error: String(err) }, 500);
  }
});
