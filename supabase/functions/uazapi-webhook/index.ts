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

    const normalizeMsgId = (value: unknown): string => {
      const raw = String(value || '').trim();
      if (!raw) return '';
      const parts = raw.split(':').filter(Boolean);
      return parts.length > 1 ? parts[parts.length - 1] : raw;
    };

    /** Upsert a reaction into metadata.reactions array */
    const upsertReaction = async (normalizedId: string, emoji: string, from: string) => {
      let { data: msgs } = await supabase
        .from('messages')
        .select('id, metadata')
        .eq('external_id', normalizedId)
        .limit(1);

      if (!msgs || msgs.length === 0) {
        const fallback = await supabase
          .from('messages')
          .select('id, metadata')
          .like('external_id', `%:${normalizedId}`)
          .limit(1);
        msgs = fallback.data || [];
      }

      if (!msgs || msgs.length === 0) {
        console.log(`Message not found for reaction target: ${normalizedId}`);
        return false;
      }

      const target = msgs[0];
      const meta = (target.metadata as Record<string, unknown>) || {};
      // Migrate legacy format
      let reactions: { emoji: string; from: string; timestamp?: string }[] =
        Array.isArray(meta.reactions) ? [...(meta.reactions as any[])] :
        meta.reaction ? [{ emoji: meta.reaction as string, from: 'contact' }] : [];

      if (emoji) {
        // Remove existing reaction from same sender, then add new
        reactions = reactions.filter((r) => r.from !== from);
        reactions.push({ emoji, from, timestamp: new Date().toISOString() });
      } else {
        // Empty emoji = remove reaction from this sender
        reactions = reactions.filter((r) => r.from !== from);
      }

      const updatedMeta = { ...meta, reactions };
      delete updatedMeta.reaction; // clean legacy

      await supabase.from('messages').update({ metadata: updatedMeta }).eq('id', target.id);
      console.log(`Reaction ${emoji ? `"${emoji}" added` : 'removed'} by ${from} on message ${target.id}`);
      return true;
    };

    const body = await req.json();
    const eventType = body.EventType || body.event || body.type || '';
    console.log('Webhook received:', eventType, JSON.stringify(body).slice(0, 500));

    // ── INCOMING MESSAGES (UazAPI format) ─────────────────────
    if (eventType === 'messages') {
      const msg = body.message || {};

      // ── Check if this is a REACTION message ──
      const msgTypeRaw = msg.messageType || msg.type || '';
      if (msgTypeRaw === 'ReactionMessage' || msgTypeRaw === 'reaction' || msg.reactionMessage) {
        const reactionData = msg.reactionMessage || msg.reaction || msg;
        const reactionEmoji = reactionData.text || reactionData.emoji || reactionData.reaction || '';
        const targetKey = reactionData.key || reactionData.message || {};
        const targetMsgId = targetKey.id || targetKey.Id || reactionData.id || reactionData.targetMessageId || msg.messageid || '';
        const isFromMe = msg.fromMe === true || msg.FromMe === true;
        const senderPhone = String(msg.chatid || msg.sender_pn || '').replace(/@.*/, '').replace(/\D/g, '');
        const from = isFromMe ? 'me' : (senderPhone || 'contact');
        
        console.log(`Reaction via messages event: emoji="${reactionEmoji}", targetMsg="${targetMsgId}", from="${from}"`);

        if (targetMsgId) {
          await upsertReaction(normalizeMsgId(targetMsgId), reactionEmoji, from);
        }

        return json({ success: true, type: 'reaction' });
      }

      // UazAPI fields: chatid, sender_pn, senderName, text, messageid, fromMe, type
      const isFromMe = msg.fromMe === true || msg.FromMe === true;
      if (isFromMe) {
        console.log('Skipping outgoing message');
        return json({ success: true, note: 'Outgoing message skipped' });
      }

      // Try multiple paths to extract phone/jid from UazAPI payload
      const rawJid = msg.chatid || msg.sender_pn || msg.Chat || msg.chat
        || msg.remoteJid || msg.from || msg.From
        || body.chat?.lead_phone || body.chat?.phone
        || '';
      
      console.log(`Phone extraction: rawJid="${String(rawJid).slice(0,60)}", msg keys=${Object.keys(msg).join(',')}, chat keys=${Object.keys(body.chat || {}).join(',')}`);
      
      const phone = String(rawJid).replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/\D/g, '');

      if (!phone || msg.isGroup === true || String(rawJid).includes('@g.us')) {
        console.log(`Skipping: phone="${phone}", isGroup=${msg.isGroup}, rawJid="${String(rawJid).slice(0,40)}"`);
        return json({ success: true, note: 'Group or invalid' });
      }

      // content can be object for media/interactive payloads — always coerce to string
      const rawContent = msg.text || msg.caption || msg.Text || msg.Body || msg.content || '';
      const messageContent = typeof rawContent === 'string'
        ? rawContent
        : (rawContent?.text || rawContent?.caption || '');

      // Prefer mediaType/messageType over generic `type` (which often comes as "chat")
      const rawMsgType = String(msg.mediaType || msg.messageType || msg.type || 'text').toLowerCase();
      const typeMap: Record<string, string> = {
        'text': 'text', 'chat': 'text', 'conversation': 'text',
        'image': 'image', 'imagemessage': 'image', 'sticker': 'sticker',
        'video': 'video', 'videomessage': 'video',
        'audio': 'audio', 'audiomessage': 'audio', 'ptt': 'audio', 'voice': 'audio', 'voicenote': 'audio',
        'document': 'document', 'documentmessage': 'document', 'pdf': 'document',
      };
      const messageType = typeMap[rawMsgType] || 'text';

      const contentObj = typeof msg.content === 'object' && msg.content !== null
        ? (msg.content as Record<string, any>)
        : null;
      const contentStr = typeof msg.content === 'string' ? msg.content.trim() : '';
      const mediaFromContentString = /^https?:\/\//i.test(contentStr) ? contentStr : null;

      let mediaUrl = msg.mediaUrl || msg.MediaUrl || msg.media_url || msg.url || msg.fileUrl || msg.downloadUrl
        || contentObj?.URL || contentObj?.url || contentObj?.mediaUrl || contentObj?.media_url || contentObj?.fileUrl || contentObj?.downloadUrl
        || contentObj?.audio?.url || contentObj?.audio?.URL || contentObj?.video?.url || contentObj?.video?.URL
        || contentObj?.image?.url || contentObj?.image?.URL || contentObj?.document?.url || contentObj?.document?.URL
        || mediaFromContentString
        || null;
      const externalId = msg.messageid || msg.id || msg.Id || null;
      const pushName = msg.senderName || msg.pushName || msg.PushName
        || body.chat?.lead_name || body.chat?.lead_fullName || null;
      const profilePic = body.chat?.imagePreview || body.chat?.image || null;

      console.log(`Processing message from ${phone}, type=${messageType}, id=${externalId}, mediaUrl="${(mediaUrl || 'NULL').slice(0, 80)}"`);

      // ── Resolve owner user_id from matching WhatsApp instance ──
      let ownerUserId: string | null = null;
      const baseUrlFromPayloadEarly = body.BaseUrl || body.baseUrl || '';
      if (baseUrlFromPayloadEarly) {
        const { data: ownerInstances } = await supabase
          .from('whatsapp_instances')
          .select('user_id, base_url')
          .limit(10);
        const matched = (ownerInstances || []).find((inst: any) => {
          const a = String(inst.base_url || '').replace(/\/+$/, '');
          const b = String(baseUrlFromPayloadEarly).replace(/\/+$/, '');
          return a === b || a.includes(b) || b.includes(a);
        });
        if (matched) ownerUserId = matched.user_id;
      }
      if (!ownerUserId) {
        // Fallback: pick the first instance's owner
        const { data: fallbackInst } = await supabase
          .from('whatsapp_instances')
          .select('user_id')
          .limit(1)
          .maybeSingle();
        if (fallbackInst) ownerUserId = fallbackInst.user_id;
      }
      console.log(`Resolved owner user_id: ${ownerUserId}`);

      // ── Download encrypted media via UazAPI and upload to Storage ──
      if (messageType !== 'text' && externalId) {
        const isEncryptedUrl = mediaUrl && (String(mediaUrl).includes('.enc') || String(mediaUrl).includes('mmg.whatsapp.net'));
        const needsDownload = !mediaUrl || isEncryptedUrl;
        
        if (needsDownload) {
          try {
            // Get UazAPI instance config to download media
            const baseUrlFromPayload = body.BaseUrl || body.baseUrl || '';
            if (baseUrlFromPayload) {
              // Find instance token by matching base_url
              const { data: instances } = await supabase
                .from('whatsapp_instances')
                .select('instance_token, base_url')
                .limit(10);
              
              const matchedInstance = (instances || []).find((inst: any) => {
                const instUrl = String(inst.base_url || '').replace(/\/+$/, '');
                const payloadUrl = String(baseUrlFromPayload).replace(/\/+$/, '');
                return instUrl === payloadUrl || instUrl.includes(payloadUrl) || payloadUrl.includes(instUrl);
              });

              if (matchedInstance?.instance_token) {
                const apiBase = String(baseUrlFromPayload).replace(/\/+$/, '');
                const token = matchedInstance.instance_token;
                
                // Try multiple UazAPI endpoint paths and body formats for downloading media
                const downloadAttempts = [
                  { ep: '/message/downloadMediaMessage', body: { id: externalId } },
                  { ep: '/message/downloadMediaMessage', body: { messageId: externalId } },
                  { ep: '/chat/downloadMediaMessage', body: { id: externalId } },
                  { ep: '/message/download', body: { id: externalId } },
                  { ep: '/message/downloadFile', body: { id: externalId } },
                ];
                
                let dlResp: Response | null = null;
                for (const attempt of downloadAttempts) {
                  console.log(`[MEDIA] Trying: POST ${attempt.ep} body=${JSON.stringify(attempt.body)}`);
                  try {
                    const resp = await fetch(`${apiBase}${attempt.ep}`, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'token': token,
                      },
                      body: JSON.stringify(attempt.body),
                    });
                    
                    if (resp.status !== 404 && resp.status !== 405 && resp.status !== 400) {
                      dlResp = resp;
                      console.log(`[MEDIA] Endpoint ${attempt.ep} responded with status ${resp.status}`);
                      break;
                    } else {
                      const errBody = await resp.text().catch(() => '');
                      console.log(`[MEDIA] ${attempt.ep} returned ${resp.status}: ${errBody.slice(0, 100)}`);
                    }
                  } catch (fetchErr) {
                    console.log(`[MEDIA] ${attempt.ep} fetch error: ${fetchErr}`);
                  }
                }
                
                if (!dlResp) {
                  console.log('[MEDIA] All download endpoints failed, keeping original mediaUrl');
                }

                if (dlResp && dlResp.ok) {
                  const contentType = dlResp.headers.get('content-type') || 'application/octet-stream';
                  
                  // Check if it's JSON (UazAPI may return a JSON with URL or base64)
                  if (contentType.includes('application/json')) {
                    const dlData = await dlResp.json();
                    console.log(`[MEDIA] UazAPI download JSON response: ${JSON.stringify(dlData).slice(0, 300)}`);
                    const downloadedUrl = dlData.url || dlData.fileURL || dlData.fileUrl || dlData.mediaUrl || dlData.file || dlData.data?.url || dlData.base64Url || '';
                    const base64Data = dlData.base64 || dlData.data || '';
                    
                    if (downloadedUrl && typeof downloadedUrl === 'string' && downloadedUrl.startsWith('http')) {
                      // Download from UazAPI file server and upload to our storage for reliable access
                      console.log(`[MEDIA] Got download URL from UazAPI: ${downloadedUrl.slice(0, 80)}`);
                      try {
                        const fileResp = await fetch(downloadedUrl);
                        if (fileResp.ok) {
                          const fileBuffer = await fileResp.arrayBuffer();
                          const fileMime = dlData.mimetype || fileResp.headers.get('content-type') || 'application/octet-stream';
                          const ext = fileMime.includes('mpeg') ? 'mp3' : fileMime.includes('ogg') ? 'ogg' : messageType === 'audio' ? 'ogg' : messageType === 'video' ? 'mp4' : messageType === 'image' ? 'jpg' : 'bin';
                          const fileName = `media/${phone}/${Date.now()}_${externalId.slice(-8)}.${ext}`;
                          const { data: upload } = await supabase.storage
                            .from('chat-media')
                            .upload(fileName, new Uint8Array(fileBuffer), { contentType: fileMime });
                          if (upload?.path) {
                            const { data: urlData } = supabase.storage.from('chat-media').getPublicUrl(upload.path);
                            mediaUrl = urlData.publicUrl;
                            console.log(`[MEDIA] Re-uploaded UazAPI file to storage: ${mediaUrl.slice(0, 80)}`);
                          } else {
                            mediaUrl = downloadedUrl; // fallback to UazAPI URL
                          }
                        } else {
                          console.log(`[MEDIA] Failed to download from UazAPI file URL (${fileResp.status}), using URL directly`);
                          mediaUrl = downloadedUrl;
                        }
                      } catch (reUploadErr) {
                        console.log(`[MEDIA] Re-upload failed, using UazAPI URL directly: ${reUploadErr}`);
                        mediaUrl = downloadedUrl;
                      }
                    } else if (base64Data && typeof base64Data === 'string' && base64Data.length > 100) {
                      const ext = messageType === 'audio' ? 'ogg' : messageType === 'video' ? 'mp4' : messageType === 'image' ? 'jpg' : 'bin';
                      const fileName = `media/${phone}/${Date.now()}_${externalId.slice(-8)}.${ext}`;
                      const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
                      const mimeMap: Record<string, string> = {
                        audio: 'audio/ogg', video: 'video/mp4', image: 'image/jpeg', document: 'application/pdf',
                      };
                      const { data: upload } = await supabase.storage
                        .from('chat-media')
                        .upload(fileName, binaryData, { contentType: mimeMap[messageType] || 'application/octet-stream' });
                      if (upload?.path) {
                        const { data: urlData } = supabase.storage.from('chat-media').getPublicUrl(upload.path);
                        mediaUrl = urlData.publicUrl;
                        console.log(`[MEDIA] Uploaded base64 media to storage: ${mediaUrl.slice(0, 80)}`);
                      }
                    } else {
                      console.log(`[MEDIA] UazAPI download returned JSON but no usable data`);
                    }
                  } else {
                    // Binary response - upload directly to storage
                    const buffer = await dlResp.arrayBuffer();
                    console.log(`[MEDIA] Got binary response: ${buffer.byteLength} bytes, type=${contentType}`);
                    if (buffer.byteLength > 0) {
                      const ext = messageType === 'audio' ? 'ogg' : messageType === 'video' ? 'mp4' : messageType === 'image' ? 'jpg' : 'bin';
                      const fileName = `media/${phone}/${Date.now()}_${externalId.slice(-8)}.${ext}`;
                      const { data: upload } = await supabase.storage
                        .from('chat-media')
                        .upload(fileName, new Uint8Array(buffer), { contentType: contentType });
                      if (upload?.path) {
                        const { data: urlData } = supabase.storage.from('chat-media').getPublicUrl(upload.path);
                        mediaUrl = urlData.publicUrl;
                        console.log(`[MEDIA] Uploaded binary media to storage: ${mediaUrl.slice(0, 80)}`);
                      } else {
                        console.log(`[MEDIA] Storage upload failed`);
                      }
                    }
                  }
                } else if (dlResp) {
                  console.log(`[MEDIA] UazAPI download failed: HTTP ${dlResp.status}`);
                  const errBody = await dlResp.text().catch(() => '');
                  console.log(`[MEDIA] Download error body: ${errBody.slice(0, 200)}`);
                }
              } else {
                console.log(`[MEDIA] No matching instance found for baseUrl: ${baseUrlFromPayload}`);
              }
            }
          } catch (dlErr) {
            console.error('[MEDIA] Download/upload error (non-fatal):', dlErr);
          }
        }
      }

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
            user_id: ownerUserId,
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
            user_id: ownerUserId,
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

      // ── AUTO-ASSIGN to attendant with lowest workload ──────
      try {
        const convFull = await supabase
          .from('conversations')
          .select('assigned_to')
          .eq('id', conversation.id)
          .single();

        // Only auto-assign if not already assigned
        if (!convFull.data?.assigned_to) {
          // Check if auto-assign is enabled (global setting)
          const { data: autoAssignSetting } = await supabase
            .from('settings')
            .select('value')
            .eq('key', 'auto_assign_enabled')
            .limit(1)
            .maybeSingle();

          const isEnabled = autoAssignSetting?.value === true || (autoAssignSetting?.value as any)?.enabled === true;

          if (isEnabled) {
            // Get all attendants
            const { data: attendants } = await supabase
              .from('user_roles')
              .select('user_id, role');

            if (attendants && attendants.length > 0) {
              const attendantIds = attendants.map((a: any) => a.user_id);

              // Count active conversations per attendant
              const { data: activeConvs } = await supabase
                .from('conversations')
                .select('assigned_to')
                .in('assigned_to', attendantIds)
                .in('status', ['open', 'in_progress', 'waiting']);

              const countMap = new Map<string, number>();
              attendantIds.forEach((id: string) => countMap.set(id, 0));
              (activeConvs || []).forEach((c: any) => {
                if (c.assigned_to) countMap.set(c.assigned_to, (countMap.get(c.assigned_to) || 0) + 1);
              });

              // Pick attendant with fewest active conversations
              let minCount = Infinity;
              let bestAgent: string | null = null;
              for (const [userId, count] of countMap) {
                if (count < minCount) {
                  minCount = count;
                  bestAgent = userId;
                }
              }

              if (bestAgent) {
                await supabase
                  .from('conversations')
                  .update({ assigned_to: bestAgent })
                  .eq('id', conversation.id);
                console.log(`Auto-assigned conversation ${conversation.id} to ${bestAgent} (${minCount} active)`);
              }
            }
          }
        }
      } catch (autoAssignErr) {
        console.error('Auto-assign error (non-fatal):', autoAssignErr);
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
        user_id: ownerUserId,
      });

      if (msgError) {
        console.error('Failed to insert message:', msgError.message);
        return json({ success: false, error: msgError.message });
      }

      // ── OUT-OF-HOURS AUTO-REPLY ───────────────────────────
      try {
        // Load all business_hours settings (any user who configured it)
        const { data: bhSettings } = await supabase
          .from('settings')
          .select('value')
          .eq('key', 'business_hours')
          .limit(1);

        const bhConfig = bhSettings?.[0]?.value as any;
        if (bhConfig?.enabled && bhConfig?.outOfHoursMessage) {
          const tz = bhConfig.timezone || 'America/Sao_Paulo';
          
          // Get current time in the configured timezone
          const nowStr = new Date().toLocaleString('en-US', { timeZone: tz });
          const now = new Date(nowStr);
          // JS: 0=Sun,1=Mon..6=Sat → config uses 1=Mon..7=Sun
          const jsDay = now.getDay();
          const dayKey = jsDay === 0 ? '7' : String(jsDay);
          const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

          const daySchedule = bhConfig.days?.[dayKey];
          let isWithinHours = false;

          if (daySchedule?.enabled && daySchedule.shifts) {
            for (const shift of daySchedule.shifts) {
              if (currentHHMM >= shift.start && currentHHMM < shift.end) {
                isWithinHours = true;
                break;
              }
            }
          }

          if (!isWithinHours) {
            console.log(`Out of business hours (day=${dayKey}, time=${currentHHMM}). Sending auto-reply.`);

            // Debounce: don't send if we already sent an out-of-hours reply to this contact in the last 30 minutes
            const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
            const { data: recentAutoReplies } = await supabase
              .from('messages')
              .select('id')
              .eq('contact_id', contact.id)
              .eq('direction', 'outbound')
              .eq('type', 'text')
              .gte('created_at', thirtyMinAgo)
              .like('content', '%fora do hor%')
              .limit(1);

            // Also check for the exact configured message
            const { data: recentExact } = await supabase
              .from('messages')
              .select('id')
              .eq('contact_id', contact.id)
              .eq('direction', 'outbound')
              .gte('created_at', thirtyMinAgo)
              .eq('content', bhConfig.outOfHoursMessage.replace('{{nome}}', pushName || '').trim())
              .limit(1);

            const alreadySent = (recentAutoReplies?.length || 0) > 0 || (recentExact?.length || 0) > 0;

            if (!alreadySent) {
              // Prepare message with variables
              let autoReplyText = bhConfig.outOfHoursMessage;
              autoReplyText = autoReplyText.replace(/\{\{nome\}\}/gi, pushName || 'cliente');

              // Send via UazAPI
              const { data: instances } = await supabase
                .from('whatsapp_instances')
                .select('id, base_url, instance_token, is_default')
                .limit(10);

              const instance = (instances || []).find((i: any) => i.is_default) || instances?.[0];
              if (instance?.base_url && instance?.instance_token) {
                const apiBase = String(instance.base_url).replace(/\/+$/, '');
                const sendResp = await fetch(`${apiBase}/send/text`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', token: instance.instance_token },
                  body: JSON.stringify({ number: phone, text: autoReplyText }),
                });

                const sendData = await sendResp.json().catch(() => ({}));
                const extId = sendData?.key?.id || sendData?.messageId || null;

                // Save to DB
                await supabase.from('messages').insert({
                  contact_id: contact.id,
                  direction: 'outbound',
                  type: 'text',
                  content: autoReplyText,
                  status: 'sent',
                  external_id: extId,
                  metadata: { auto_reply: 'out_of_hours' },
                });

                console.log(`Out-of-hours auto-reply sent to ${phone}`);
              }
            } else {
              console.log(`Skipping out-of-hours reply (debounced) for ${phone}`);
            }
          }
        }
      } catch (oohErr) {
        console.error('Out-of-hours auto-reply error (non-fatal):', oohErr);
      }

      // ── LEAD SCORING ──────────────────────────────────────
      if (conversation) {
        try {
          // Get conversation funnel info
          const { data: convFull } = await supabase
            .from('conversations')
            .select('funnel_id, score')
            .eq('id', conversation.id)
            .single();

          if (convFull?.funnel_id) {
            // Load scoring rules for this funnel
            const { data: rules } = await supabase
              .from('scoring_rules')
              .select('*')
              .eq('funnel_id', convFull.funnel_id)
              .eq('is_active', true);

            let pointsDelta = 0;
            for (const rule of (rules || [])) {
              if (rule.event_type === 'message_received' || rule.event_type === 'reply_received') {
                pointsDelta += rule.points;
              }
              if (rule.event_type === 'media_received' && messageType !== 'text') {
                pointsDelta += rule.points;
              }
              if (rule.event_type === 'keyword_match') {
                const keywords = String((rule.condition as any)?.keywords || '').split(',').map((k: string) => k.trim().toLowerCase()).filter(Boolean);
                const content = (messageContent || '').toLowerCase();
                if (keywords.some((kw: string) => content.includes(kw))) {
                  pointsDelta += rule.points;
                }
              }
            }

            if (pointsDelta !== 0) {
              const newScore = (convFull.score || 0) + pointsDelta;
              await supabase.from('conversations').update({ score: newScore }).eq('id', conversation.id);
              console.log(`Score updated: ${convFull.score || 0} → ${newScore} (delta: ${pointsDelta})`);

              // Check if score triggers stage auto-move
              const { data: stages } = await supabase
                .from('funnel_stages')
                .select('id, score_threshold, position')
                .eq('funnel_id', convFull.funnel_id)
                .not('score_threshold', 'is', null)
                .order('score_threshold', { ascending: false });

              if (stages && stages.length > 0) {
                for (const stage of stages) {
                  if (newScore >= (stage.score_threshold || 0)) {
                    await supabase.from('conversations').update({ funnel_stage_id: stage.id }).eq('id', conversation.id);
                    console.log(`Auto-moved to stage ${stage.id} (threshold: ${stage.score_threshold})`);
                    break;
                  }
                }
              }
            }
          }
        } catch (scoreErr) {
          console.error('Scoring error (non-fatal):', scoreErr);
        }
      }

      // ── TRIGGER AUTOMATIONS ──────────────────────────────
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        
        // Check if contact was just created (first contact)
        const isFirstContact = !contact || (contact as any).__isNew;
        
        fetch(`${supabaseUrl}/functions/v1/automation-execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({
            contactId: contact.id,
            contactPhone: phone,
            contactName: pushName || '',
            messageContent,
            messageType,
            conversationId: conversation.id,
            isFirstContact: !!isFirstContact,
          }),
        }).catch((err: any) => console.error('Automation trigger failed:', err));
      } catch (autoErr) {
        console.error('Automation trigger error (non-fatal):', autoErr);
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

    // ── REACTION EVENTS ─────────────────────────────────────
    if (eventType === 'messages.reaction' || eventType === 'reaction' || eventType === 'message.reaction') {
      const reaction = body.reaction || body.message?.reaction || body.data || {};
      const reactionEmoji = reaction.text || reaction.emoji || reaction.reaction || '';
      const targetMsgId = reaction.id || reaction.messageId || reaction.key?.id || body.messageId || '';
      const fromMe = reaction.fromMe === true || body.fromMe === true;
      const senderPhone = String(reaction.sender || reaction.participant || body.sender || '').replace(/@.*/, '').replace(/\D/g, '');
      const from = fromMe ? 'me' : (senderPhone || 'contact');

      console.log(`Reaction received: emoji="${reactionEmoji}", targetMsg="${targetMsgId}", from="${from}"`);

      if (!targetMsgId) {
        return json({ success: true, note: 'No target message ID for reaction' });
      }

      await upsertReaction(normalizeMsgId(targetMsgId), reactionEmoji, from);
      return json({ success: true });
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
