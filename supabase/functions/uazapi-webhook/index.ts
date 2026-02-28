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
    const eventType = body.EventType || body.event || body.type || '';
    console.log('Webhook received:', eventType, JSON.stringify(body).slice(0, 500));

    // ── INCOMING MESSAGES (UazAPI format) ─────────────────────
    if (eventType === 'messages') {
      const msg = body.message || {};
      console.log('Message keys:', Object.keys(msg).join(', '));
      console.log('Message object:', JSON.stringify(msg).slice(0, 1000));
      console.log('Body top-level keys:', Object.keys(body).join(', '));

      // Try multiple field names for the chat/phone JID
      const chat = msg.Chat || msg.chat || msg.remoteJid || msg.From || msg.from
        || body.chat?.jid || body.chat?.id_whatsapp || body.jid || '';
      
      // UazAPI may send phone directly
      const senderPhone = msg.SenderPhone || msg.senderPhone || msg.Phone || msg.phone || '';
      
      const rawPhone = senderPhone || chat;
      const phone = String(rawPhone).replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/\D/g, '');
      
      console.log(`Resolved: chat="${chat}", senderPhone="${senderPhone}", phone="${phone}"`);

      if (!phone || String(rawPhone).includes('@g.us')) {
        console.log('Skipping: no phone or group message');
        return json({ success: true, note: 'Group or invalid' });
      }

      // UazAPI message fields
      const isFromMe = msg.FromMe === true || msg.fromMe === true;
      if (isFromMe) {
        console.log('Skipping outgoing message');
        return json({ success: true, note: 'Outgoing message skipped' });
      }

      // Extract text content - UazAPI uses Text, Body, or nested message
      const messageContent = msg.Text || msg.text || msg.Body || msg.body
        || msg.Conversation || msg.conversation
        || msg.Caption || msg.caption
        || '';

      // Determine message type
      const msgType = msg.Type || msg.type || 'text';
      const typeMap: Record<string, string> = {
        'text': 'text', 'chat': 'text', 'conversation': 'text',
        'image': 'image', 'imageMessage': 'image',
        'video': 'video', 'videoMessage': 'video',
        'audio': 'audio', 'audioMessage': 'audio', 'ptt': 'audio',
        'document': 'document', 'documentMessage': 'document',
        'sticker': 'sticker', 'stickerMessage': 'sticker',
      };
      const messageType = typeMap[msgType] || 'text';

      const mediaUrl = msg.MediaUrl || msg.mediaUrl || msg.Media || null;
      const externalId = msg.Id || msg.id || msg.ID || null;
      const pushName = msg.PushName || msg.pushName || msg.NotifyName
        || body.chat?.lead_name || body.chat?.lead_fullName || null;
      const profilePic = body.chat?.imagePreview || body.chat?.image || null;

      console.log(`Processing message from ${phone}, type=${messageType}, id=${externalId}, text="${messageContent?.slice(0, 50)}"`);

      // Find or create contact
      let { data: contact } = await supabase
        .from('contacts')
        .select('id')
        .eq('phone', phone)
        .single();

      if (!contact) {
        const { data: newContact } = await supabase
          .from('contacts')
          .insert({
            phone,
            name: pushName,
            profile_picture: profilePic,
            last_message_at: new Date().toISOString(),
          })
          .select('id')
          .single();
        contact = newContact;
        console.log('Created new contact:', contact?.id);
      } else {
        const updateData: Record<string, unknown> = { last_message_at: new Date().toISOString() };
        if (pushName) updateData.name = pushName;
        if (profilePic) updateData.profile_picture = profilePic;
        await supabase.from('contacts').update(updateData).eq('id', contact.id);
      }

      if (!contact) {
        console.error('Failed to create/find contact');
        return json({ success: false, error: 'Contact creation failed' });
      }

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
        console.log('Created new conversation:', conversation?.id);
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

      if (!conversation) {
        console.error('Failed to create/find conversation');
        return json({ success: false, error: 'Conversation creation failed' });
      }

      // Insert message
      const { error: msgError } = await supabase.from('messages').insert({
        contact_id: contact.id,
        external_id: externalId,
        direction: 'inbound',
        type: messageType,
        content: messageContent || null,
        media_url: mediaUrl,
        status: 'received',
        metadata: { pushName, chat, profilePic },
      });

      if (msgError) {
        console.error('Failed to insert message:', msgError.message);
        return json({ success: false, error: msgError.message });
      }

      console.log('Message saved successfully');
      return json({ success: true });
    }

    // ── STATUS UPDATES (UazAPI format) ────────────────────────
    if (eventType === 'messages_update') {
      const evt = body.event;
      if (!evt) return json({ success: true, note: 'No event data' });

      const statusType = evt.Type || evt.type || body.state || '';
      const messageIds = evt.MessageIDs || evt.messageIDs || [];

      const statusMap: Record<string, string> = {
        'Sent': 'sent', 'Delivered': 'delivered', 'Read': 'read',
        'Played': 'played', 'Error': 'error',
        'sent': 'sent', 'delivered': 'delivered', 'read': 'read',
        'played': 'played', 'error': 'error',
      };
      const statusStr = statusMap[statusType] || 'sent';

      console.log(`Status update: ${statusType} -> ${statusStr} for ${messageIds.length} messages`);

      for (const msgId of messageIds) {
        await supabase
          .from('messages')
          .update({ status: statusStr })
          .eq('external_id', msgId);

        // Update campaign_contacts if applicable
        if (statusStr === 'delivered' || statusStr === 'read') {
          const updateData: Record<string, string> = { status: statusStr };
          if (statusStr === 'delivered') updateData.delivered_at = new Date().toISOString();
          if (statusStr === 'read') updateData.read_at = new Date().toISOString();

          await supabase
            .from('campaign_contacts')
            .update(updateData)
            .eq('message_id', msgId);
        }
      }

      return json({ success: true, processed: messageIds.length });
    }

    // ── OTHER EVENTS (chats, connection, etc.) ────────────────
    console.log('Unhandled event type:', eventType);
    return json({ success: true, event: eventType, note: 'Event not handled' });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Webhook error:', message);
    return json({ error: message }, 500);
  }
});
