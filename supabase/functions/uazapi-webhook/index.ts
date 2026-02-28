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

      // UazAPI fields: chatid, sender_pn, senderName, text, messageid, fromMe, type
      const isFromMe = msg.fromMe === true || msg.FromMe === true;
      if (isFromMe) {
        console.log('Skipping outgoing message');
        return json({ success: true, note: 'Outgoing message skipped' });
      }

      const rawJid = msg.chatid || msg.sender_pn || msg.Chat || msg.chat || '';
      const phone = String(rawJid).replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/\D/g, '');

      if (!phone || msg.isGroup === true || String(rawJid).includes('@g.us')) {
        console.log('Skipping: no phone or group message');
        return json({ success: true, note: 'Group or invalid' });
      }

      const messageContent = msg.text || msg.content || msg.Text || msg.Body || msg.caption || '';
      const msgType = msg.type || msg.mediaType || 'text';
      const typeMap: Record<string, string> = {
        'text': 'text', 'chat': 'text', 'conversation': 'text',
        'image': 'image', 'video': 'video', 'audio': 'audio',
        'ptt': 'audio', 'document': 'document', 'sticker': 'sticker',
      };
      const messageType = typeMap[msgType] || 'text';

      const mediaUrl = msg.mediaUrl || msg.MediaUrl || null;
      const externalId = msg.messageid || msg.id || msg.Id || null;
      const pushName = msg.senderName || msg.pushName || msg.PushName
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
        .select('id, unread_count, status')
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
        const updateData: Record<string, unknown> = {
          last_message_at: new Date().toISOString(),
          unread_count: (conversation.unread_count || 0) + 1,
        };
        // Reopen only if conversation was resolved
        if (conversation.status === 'resolved') {
          updateData.status = 'open';
          updateData.funnel_stage_id = null;
          console.log('Reopening resolved conversation:', conversation.id);
        }
        await supabase
          .from('conversations')
          .update(updateData)
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
        metadata: { pushName, remoteJid: rawJid, profilePic },
      });

      if (msgError) {
        console.error('Failed to insert message:', msgError.message);
        return json({ success: false, error: msgError.message });
      }

      console.log('Message saved successfully');
      return json({ success: true });
    }

    // ── STATUS UPDATES (UazAPI v2 format) ────────────────────
    // UazAPI can send status in multiple formats:
    // 1. { EventType: "messages_update", event: { Type: "Delivered", MessageIDs: [...] } }
    // 2. { event: "message.status", status: "delivered", messageId: "..." }
    // 3. { type: "ack", ack: 3, id: "..." }  (WhatsApp ack levels: 1=sent, 2=delivered, 3=read)
    // 4. { EventType: "messages_update", data: [{ id: "...", status: "delivered" }] }
    if (eventType === 'messages_update' || eventType === 'message.status' || eventType === 'ack' || eventType === 'status') {
      // Collect message IDs and their status
      const updates: { msgId: string; status: string }[] = [];

      // Format 1: event.Type + event.MessageIDs
      const evt = body.event && typeof body.event === 'object' ? body.event : null;
      if (evt) {
        const statusType = evt.Type || evt.type || evt.status || '';
        const messageIds = evt.MessageIDs || evt.messageIDs || evt.messageIds || [];
        if (messageIds.length > 0 && statusType) {
          for (const id of messageIds) {
            updates.push({ msgId: id, status: statusType });
          }
        }
      }

      // Format 2: body.status + body.messageId
      if (body.messageId && (body.status || body.state)) {
        updates.push({ msgId: body.messageId, status: body.status || body.state });
      }

      // Format 3: WhatsApp ack levels
      if (body.ack !== undefined && (body.id || body.messageId)) {
        const ackMap: Record<number, string> = { 1: 'sent', 2: 'delivered', 3: 'read' };
        const ackStatus = ackMap[body.ack] || '';
        if (ackStatus) {
          updates.push({ msgId: body.id || body.messageId, status: ackStatus });
        }
      }

      // Format 4: data array
      if (Array.isArray(body.data)) {
        for (const item of body.data) {
          if (item.id && item.status) {
            updates.push({ msgId: item.id, status: item.status });
          }
        }
      }

      // Normalize status strings
      const statusMap: Record<string, string> = {
        'Sent': 'sent', 'Delivered': 'delivered', 'Read': 'read',
        'Played': 'read', 'Error': 'error',
        'sent': 'sent', 'delivered': 'delivered', 'read': 'read',
        'played': 'read', 'error': 'error',
        'DELIVERY_ACK': 'delivered', 'READ': 'read', 'SENT': 'sent',
        'server': 'sent', 'device': 'delivered', 'played': 'read',
      };

      const normalizeMsgId = (value: unknown): string => {
        const raw = String(value || '').trim();
        if (!raw) return '';
        const parts = raw.split(':').filter(Boolean);
        return parts.length > 1 ? parts[parts.length - 1] : raw;
      };

      console.log(`Status updates to process: ${updates.length}`, JSON.stringify(updates).slice(0, 300));

      const affectedCampaignIds = new Set<string>();

      for (const { msgId, status: rawStatus } of updates) {
        const normalizedMsgId = normalizeMsgId(msgId);
        const statusStr = statusMap[rawStatus] || statusMap[String(rawStatus || '').toLowerCase()] || String(rawStatus || '').toLowerCase();
        if (!normalizedMsgId || !statusStr || statusStr === 'error') continue;

        // Update messages table (supports both normalized and prefixed external_id)
        await supabase
          .from('messages')
          .update({ status: statusStr })
          .eq('external_id', normalizedMsgId);

        await supabase
          .from('messages')
          .update({ status: statusStr })
          .like('external_id', `%:${normalizedMsgId}`);

        // Update campaign_contacts if applicable
        if (statusStr === 'delivered' || statusStr === 'read') {
          const updateData: Record<string, string> = { status: statusStr };
          if (statusStr === 'delivered') updateData.delivered_at = new Date().toISOString();
          if (statusStr === 'read') {
            updateData.read_at = new Date().toISOString();
            // Also set delivered_at if not already set
            updateData.delivered_at = new Date().toISOString();
          }

          let { data: updatedRows } = await supabase
            .from('campaign_contacts')
            .update(updateData)
            .eq('message_id', normalizedMsgId)
            .select('campaign_id');

          if (!updatedRows || updatedRows.length === 0) {
            const fallback = await supabase
              .from('campaign_contacts')
              .update(updateData)
              .like('message_id', `%:${normalizedMsgId}`)
              .select('campaign_id');
            updatedRows = fallback.data || [];
          }

          if (updatedRows && updatedRows.length > 0) {
            for (const row of updatedRows) {
              if (row.campaign_id) affectedCampaignIds.add(row.campaign_id);
            }
          }
        }
      }

      // Recalculate stats for affected campaigns
      for (const campId of affectedCampaignIds) {
        const { data: allContacts } = await supabase
          .from('campaign_contacts')
          .select('status')
          .eq('campaign_id', campId);

        if (allContacts) {
          const stats = {
            total: allContacts.length,
            sent: allContacts.filter((c: any) => ['sent', 'delivered', 'read'].includes(c.status)).length,
            delivered: allContacts.filter((c: any) => ['delivered', 'read'].includes(c.status)).length,
            read: allContacts.filter((c: any) => c.status === 'read').length,
            failed: allContacts.filter((c: any) => c.status === 'failed').length,
          };
          await supabase.from('campaigns').update({ stats }).eq('id', campId);
          console.log(`Updated campaign ${campId} stats:`, JSON.stringify(stats));
        }
      }

      return json({ success: true, processed: updates.length, campaignsUpdated: affectedCampaignIds.size });
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
