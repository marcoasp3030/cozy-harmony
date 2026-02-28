import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, token, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
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

    const body = await req.json();
    console.log('Webhook received:', JSON.stringify(body).slice(0, 1000));

    // UazAPI sends different event types
    const event = body.event || body.type || '';
    const data = body.data || body;

    // Handle incoming messages
    if (event === 'messages.upsert' || event === 'message' || event === 'messages') {
      const messages = Array.isArray(data.messages || data) ? (data.messages || data) : [data];

      for (const msg of messages) {
        const isFromMe = msg.key?.fromMe || msg.fromMe || false;
        if (isFromMe) continue; // Skip outgoing messages

        const remoteJid = msg.key?.remoteJid || msg.from || msg.remoteJid || '';
        const phone = remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '');
        if (!phone || phone.includes('@g.us')) continue; // Skip groups

        const messageContent = msg.message?.conversation
          || msg.message?.extendedTextMessage?.text
          || msg.message?.imageMessage?.caption
          || msg.message?.videoMessage?.caption
          || msg.message?.documentMessage?.caption
          || msg.body
          || msg.text
          || '';

        const messageType = msg.message?.imageMessage ? 'image'
          : msg.message?.videoMessage ? 'video'
          : msg.message?.audioMessage ? 'audio'
          : msg.message?.documentMessage ? 'document'
          : msg.message?.stickerMessage ? 'sticker'
          : 'text';

        const mediaUrl = msg.message?.imageMessage?.url
          || msg.message?.videoMessage?.url
          || msg.message?.audioMessage?.url
          || msg.message?.documentMessage?.url
          || null;

        const externalId = msg.key?.id || msg.id || null;

        // Find or create contact
        let { data: contact } = await supabase
          .from('contacts')
          .select('id')
          .eq('phone', phone)
          .single();

        if (!contact) {
          const pushName = msg.pushName || msg.notifyName || null;
          const { data: newContact } = await supabase
            .from('contacts')
            .insert({
              phone,
              name: pushName,
              last_message_at: new Date().toISOString(),
            })
            .select('id')
            .single();
          contact = newContact;
        } else {
          await supabase
            .from('contacts')
            .update({ last_message_at: new Date().toISOString() })
            .eq('id', contact.id);
        }

        if (!contact) continue;

        // Find or create conversation
        let { data: conversation } = await supabase
          .from('conversations')
          .select('id, unread_count')
          .eq('contact_id', contact.id)
          .single();

        if (!conversation) {
          const { data: newConv } = await supabase
            .from('conversations')
            .insert({
              contact_id: contact.id,
              status: 'open',
              last_message_at: new Date().toISOString(),
              unread_count: 1,
            })
            .select('id, unread_count')
            .single();
          conversation = newConv;
        } else {
          await supabase
            .from('conversations')
            .update({
              last_message_at: new Date().toISOString(),
              unread_count: (conversation.unread_count || 0) + 1,
              status: 'open',
            })
            .eq('id', conversation.id);
        }

        if (!conversation) continue;

        // Insert message
        await supabase.from('messages').insert({
          contact_id: contact.id,
          external_id: externalId,
          direction: 'inbound',
          type: messageType,
          content: messageContent || null,
          media_url: mediaUrl,
          status: 'received',
          metadata: { pushName: msg.pushName, remoteJid },
        });
      }

      return json({ success: true, processed: messages.length });
    }

    // Handle message status updates (sent, delivered, read)
    if (event === 'messages.update' || event === 'message.update' || event === 'status') {
      const updates = Array.isArray(data) ? data : [data];

      for (const update of updates) {
        const externalId = update.key?.id || update.id;
        const status = update.update?.status || update.status;
        if (!externalId) continue;

        const statusMap: Record<number, string> = {
          0: 'error', 1: 'pending', 2: 'sent', 3: 'delivered', 4: 'read', 5: 'played',
        };
        const statusStr = typeof status === 'number' ? (statusMap[status] || 'sent') : (status || 'sent');

        await supabase
          .from('messages')
          .update({ status: statusStr })
          .eq('external_id', externalId);

        // Update campaign_contacts if applicable
        if (statusStr === 'delivered' || statusStr === 'read') {
          const updateData: Record<string, string> = {};
          if (statusStr === 'delivered') updateData.delivered_at = new Date().toISOString();
          if (statusStr === 'read') updateData.read_at = new Date().toISOString();
          updateData.status = statusStr;

          await supabase
            .from('campaign_contacts')
            .update(updateData)
            .eq('message_id', externalId);
        }
      }

      return json({ success: true });
    }

    return json({ success: true, event, note: 'Event not handled' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Webhook error:', message);
    return json({ error: message }, 500);
  }
});
