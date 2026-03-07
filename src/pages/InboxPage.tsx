import { useState, useEffect, useRef, useCallback } from "react";
import { Search, Send, Phone, MoreVertical, Kanban, List, StickyNote, LayoutTemplate, Slash, ArrowLeft, Brain, Loader2, Sparkles, FileText as SummarizeIcon, MousePointerClick, X, ThumbsUp, ThumbsDown, SearchCheck } from "lucide-react";
import { MediaUploader, AttachmentPreview, uploadMediaFile } from "@/components/inbox/MediaUploader";
import type { MediaAttachment } from "@/components/inbox/MediaUploader";
import AudioRecorder from "@/components/inbox/AudioRecorder";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useWhatsAppInstances } from "@/hooks/useWhatsAppInstances";
import InstanceSelector from "@/components/shared/InstanceSelector";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import KanbanView from "@/components/inbox/KanbanView";
import MessageBubble from "@/components/inbox/MessageBubble";
import ContactPanel from "@/components/inbox/ContactPanel";
import { useSlaNotifications } from "@/hooks/useSlaNotifications";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Message } from "@/components/inbox/MessageBubble";
import InteractiveMessageBuilder, { getDefaultInteractive, type InteractiveMessage } from "@/components/shared/InteractiveMessageBuilder";
import GlobalMessageSearch from "@/components/inbox/GlobalMessageSearch";

interface Contact {
  id: string;
  name: string | null;
  phone: string;
  profile_picture: string | null;
  about: string | null;
  is_blocked: boolean | null;
  email?: string | null;
  created_at?: string;
  custom_fields?: Record<string, any> | null;
}

interface Conversation {
  id: string;
  contact_id: string;
  status: string;
  unread_count: number | null;
  last_message_at: string | null;
  notes: string | null;
  assigned_to: string | null;
  priority?: string;
  sla_hours?: number | null;
  score?: number;
  contact?: Contact;
  lastMessage?: Message;
}

interface Tag {
  id: string;
  name: string;
  color: string;
}

const formatTime = (dateStr: string) => {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000 && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  if (diff < 172800000) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};

const getInitials = (name: string | null, phone: string) => {
  if (name) return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  return phone.slice(-2);
};

const InboxPage = () => {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [contactTags, setContactTags] = useState<Tag[]>([]);
  const [templates, setTemplates] = useState<{ id: string; name: string; content: string; category: string | null }[]>([]);
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateOpen, setTemplateOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "kanban">(() => {
    return (localStorage.getItem("inbox_view_mode") as "list" | "kanban") || "list";
  });
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterAgent, setFilterAgent] = useState<string>("all");
  const [isNoteMode, setIsNoteMode] = useState(false);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiProvider, setAiProvider] = useState<string | null>(null);
  const [mediaAttachment, setMediaAttachment] = useState<MediaAttachment | null>(null);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [interactiveOpen, setInteractiveOpen] = useState(false);
  const [interactiveMsg, setInteractiveMsg] = useState<InteractiveMessage>(getDefaultInteractive());
  const [aiSuggestion, setAiSuggestion] = useState<{ stage_id: string; stage_name: string; stage_color: string; reason: string; intent: string } | null>(null);
  const [replySuggestions, setReplySuggestions] = useState<{ label: string; text: string }[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const smartFunnelConfigRef = useRef<{ enabled: boolean; provider: string; model: string; min_confidence: number } | null>(null);
  const aiTimeoutRef = useRef<number>(30);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pendingTempIdsRef = useRef<Set<string>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { instances, defaultInstance } = useWhatsAppInstances();
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [agentProfiles, setAgentProfiles] = useState<{ user_id: string; name: string }[]>([]);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);

  const selectedConv = conversations.find((c) => c.id === selectedConvId);
  const contact = selectedConv?.contact;

  // SLA notifications
  useSlaNotifications(conversations);
  const { notifyNewMessage } = usePushNotifications();

  // Load smart funnel config + AI timeout
  useEffect(() => {
    if (!user) return;
    supabase
      .from("settings")
      .select("key, value")
      .eq("user_id", user.id)
      .in("key", ["smart_funnel", "ai_timeout"])
      .then(({ data }) => {
        if (data) {
          for (const row of data) {
            if (row.key === "smart_funnel") {
              smartFunnelConfigRef.current = row.value as any;
            }
            if (row.key === "ai_timeout") {
              const val = row.value as { seconds?: number };
              if (val?.seconds) aiTimeoutRef.current = val.seconds;
            }
          }
        }
        if (!smartFunnelConfigRef.current) {
          smartFunnelConfigRef.current = { enabled: true, provider: "openai", model: "gpt-4o-mini", min_confidence: 0.7 };
        }
      });
  }, [user]);

  // Load conversations
  const loadConversations = useCallback(async () => {
    const { data: convs } = await supabase
      .from("conversations")
      .select("*")
      .order("last_message_at", { ascending: false });

    if (!convs || convs.length === 0) {
      setConversations([]);
      return;
    }

    const contactIds = [...new Set(convs.map((c) => c.contact_id))];
    const { data: contacts } = await supabase.from("contacts").select("*").in("id", contactIds);
    const contactMap = new Map((contacts || []).map((c) => [c.id, c]));

    const { data: allMessages } = await supabase
      .from("messages")
      .select("*")
      .in("contact_id", contactIds)
      .order("created_at", { ascending: false })
      .limit(contactIds.length * 2);

    const lastMsgMap = new Map<string, Message>();
    for (const msg of (allMessages || []) as Message[]) {
      if (msg.contact_id && !lastMsgMap.has(msg.contact_id)) {
        lastMsgMap.set(msg.contact_id, msg);
      }
    }

    const enriched: Conversation[] = convs.map((conv) => ({
      ...conv,
      unread_count: conv.unread_count ?? 0,
      assigned_to: conv.assigned_to ?? null,
      contact: contactMap.get(conv.contact_id) as Contact | undefined,
      lastMessage: lastMsgMap.get(conv.contact_id),
    }));

    setConversations(enriched);
  }, []);

  const loadMessages = useCallback(async (contactId: string) => {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: true })
      .limit(200);
    setMessages((data as Message[]) || []);
  }, []);

  const loadContactTags = useCallback(async (contactId: string) => {
    const { data } = await supabase.from("contact_tags").select("tag_id").eq("contact_id", contactId);
    if (data && data.length > 0) {
      const tagIds = data.map((ct) => ct.tag_id);
      const { data: tags } = await supabase.from("tags").select("*").in("id", tagIds);
      setContactTags((tags as Tag[]) || []);
    } else {
      setContactTags([]);
    }
  }, []);

  // Load templates
  useEffect(() => {
    supabase.from("templates").select("id, name, content, category").order("name").then(({ data }) => {
      setTemplates((data as any[]) || []);
    });
  }, []);

  // Load agent profiles (users with roles)
  useEffect(() => {
    const load = async () => {
      const { data: roles } = await supabase.from("user_roles").select("user_id");
      if (!roles?.length) return;
      const ids = roles.map((r: any) => r.user_id);
      const { data: profiles } = await supabase.from("profiles").select("user_id, name").in("user_id", ids);
      setAgentProfiles((profiles as any[]) || []);
    };
    load();
  }, []);

  useEffect(() => {
    setLoading(true);
    loadConversations().finally(() => setLoading(false));
  }, [loadConversations]);

  useEffect(() => {
    if (!selectedConv?.contact_id) return;
    setReplySuggestions([]);
    loadMessages(selectedConv.contact_id);
    loadContactTags(selectedConv.contact_id);
    if (selectedConv.unread_count && selectedConv.unread_count > 0) {
      supabase.from("conversations").update({ unread_count: 0 }).eq("id", selectedConv.id).then(() => {
        setConversations((prev) => prev.map((c) => (c.id === selectedConv.id ? { ...c, unread_count: 0 } : c)));
      });
    }
  }, [selectedConvId, selectedConv?.contact_id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Debounced reload
  const reloadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedReload = useCallback(() => {
    if (reloadTimeoutRef.current) clearTimeout(reloadTimeoutRef.current);
    reloadTimeoutRef.current = setTimeout(() => loadConversations(), 500);
  }, [loadConversations]);

  // Notification sound
  const playNotificationSound = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } catch {}
  }, []);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel("inbox-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const msg = payload.new as Message;
        // Skip messages we sent optimistically (will be replaced by the send flow)
        if (msg.direction === "outbound" && pendingTempIdsRef.current.size > 0) {
          // Replace the optimistic message with the real DB row
          const tempId = [...pendingTempIdsRef.current][0];
          pendingTempIdsRef.current.delete(tempId);
          setMessages((prev) => prev.map((m) => m.id === tempId ? msg : m));
          debouncedReload();
          return;
        }
        if (msg.direction === "inbound") {
          const soundEnabled = localStorage.getItem("notification_sound_enabled") !== "false";
          if (soundEnabled) playNotificationSound();
          // Push notification for inbound messages
          const senderConv = conversations.find((c) => c.contact?.id === msg.contact_id);
          notifyNewMessage(
            senderConv?.contact?.name || "",
            msg.content || "Mídia recebida",
            senderConv?.contact?.phone
          );
          // Trigger AI funnel suggestion
          const sfConfig = smartFunnelConfigRef.current;
          if (sfConfig?.enabled && selectedConv && msg.contact_id === selectedConv.contact_id && msg.content) {
            supabase.functions.invoke("smart-funnel", {
              body: {
                conversation_id: selectedConv.id,
                message_content: msg.content,
                contact_name: selectedConv.contact?.name,
                provider: sfConfig.provider,
                model: sfConfig.model,
              }
            }).then(({ data }) => {
              if (data?.suggestion) {
                setAiSuggestion({ ...data.suggestion, reason: data.reason, intent: data.intent });
              }
            }).catch(() => {});
          }
        }
        if (selectedConv && msg.contact_id === selectedConv.contact_id) {
          setMessages((prev) => {
            if (prev.find((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
        }
        debouncedReload();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) => {
        const msg = payload.new as Message;
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => debouncedReload())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (reloadTimeoutRef.current) clearTimeout(reloadTimeoutRef.current);
    };
  }, [selectedConv?.contact_id, debouncedReload]);

  // Send message or internal note
  const handleSend = async () => {
    if ((!newMessage.trim() && !mediaAttachment) || !contact || sending) return;

    if (isNoteMode) {
      if (!newMessage.trim()) return;
      setSending(true);
      try {
        await supabase.from("messages").insert({
          contact_id: contact.id,
          direction: "outbound",
          type: "note",
          content: newMessage.trim(),
          status: "read",
        });
        setNewMessage("");
        setIsNoteMode(false);
        toast.success("Nota interna adicionada");
      } catch {
        toast.error("Erro ao salvar nota");
      } finally {
        setSending(false);
      }
      return;
    }

    // Capture values before clearing
    const messageText = newMessage.trim();
    const currentAttachment = mediaAttachment;
    const currentInteractive = { ...interactiveMsg };
    const isInteractive = currentInteractive.type !== "none" && currentInteractive.body;
    const tempId = `temp-${Date.now()}`;

    // Optimistic: show message instantly
    const optimisticMsg: Message = {
      id: tempId,
      contact_id: contact.id,
      direction: "outbound",
      type: isInteractive ? "interactive" : (currentAttachment ? currentAttachment.type : "text"),
      content: isInteractive ? currentInteractive.body : (messageText || currentAttachment?.file.name || null),
      media_url: currentAttachment ? URL.createObjectURL(currentAttachment.file) : null,
      status: "sending",
      created_at: new Date().toISOString(),
      external_id: null,
      metadata: isInteractive ? {
        header: currentInteractive.header || undefined,
        body: currentInteractive.body,
        footer: currentInteractive.footer || undefined,
        interactiveType: currentInteractive.type,
        buttons: currentInteractive.buttons,
        listButtonText: currentInteractive.listButtonText,
        listSections: currentInteractive.listSections,
        ctaButtons: currentInteractive.ctaButtons,
      } : null,
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setNewMessage("");
    setMediaAttachment(null);
    setInteractiveMsg(getDefaultInteractive());
    pendingTempIdsRef.current.add(tempId);

    // Send in background (fire-and-forget)
    (async () => {
      try {
        let mediaUrl: string | null = null;
        let msgType = currentAttachment ? currentAttachment.type : "text";

        if (currentAttachment) {
          mediaUrl = await uploadMediaFile(currentAttachment.file);
        }

        const sendBody: Record<string, any> = {
          type: msgType,
          number: contact.phone,
          instanceId: selectedInstanceId || defaultInstance?.id || undefined,
        };

        if (isInteractive) {
          sendBody.type = "interactive";
          sendBody.interactive = currentInteractive;
          sendBody.text = currentInteractive.body;
        } else if (msgType === "text") {
          sendBody.text = messageText;
        } else {
          sendBody.mediaUrl = mediaUrl;
          if (messageText) sendBody.caption = messageText;
          if (msgType === "document") sendBody.filename = currentAttachment?.file.name;
        }

        const { data, error } = await supabase.functions.invoke("uazapi-send", { body: sendBody });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        const externalId = data?.key?.id || data?.messageId || data?.id || data?.message?.id || data?.message?.key?.id || null;
        console.log('UazAPI send response:', JSON.stringify(data));

        // Insert into DB — realtime will swap the optimistic msg automatically
        await supabase.from("messages").insert({
          contact_id: contact.id,
          direction: "outbound",
          type: isInteractive ? "interactive" : msgType,
          content: isInteractive ? currentInteractive.body : (msgType === "text" ? messageText : (messageText || currentAttachment?.file.name || null)),
          media_url: mediaUrl,
          status: "sent",
          external_id: externalId,
          metadata: { ...optimisticMsg.metadata, source: "manual" },
        } as any);

        // Cleanup: if realtime didn't fire yet, update optimistic directly
        setTimeout(() => {
          pendingTempIdsRef.current.delete(tempId);
          setMessages((prev) => prev.map((m) => m.id === tempId ? { ...m, status: "sent" } : m));
        }, 3000);

        supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", selectedConvId);
      } catch (err: any) {
        pendingTempIdsRef.current.delete(tempId);
        setMessages((prev) => prev.map((m) => m.id === tempId ? { ...m, status: "error" } : m));
        toast.error("Erro ao enviar: " + (err.message || "Tente novamente"));
      }
    })();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Retry a failed message
  const handleRetry = useCallback(async (msg: Message) => {
    if (!contact) return;
    // Remove the failed message from UI
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
    // Delete from DB if it was persisted
    if (!msg.id.startsWith("temp-")) {
      await supabase.from("messages").delete().eq("id", msg.id);
    }
    // Re-compose and re-send
    const tempId = `temp-${Date.now()}`;
    const optimistic: Message = { ...msg, id: tempId, status: "sending", created_at: new Date().toISOString() };
    setMessages((prev) => [...prev, optimistic]);
    pendingTempIdsRef.current.add(tempId);

    try {
      const sendBody: Record<string, any> = {
        type: msg.type === "interactive" ? "interactive" : msg.type,
        number: contact.phone,
        instanceId: selectedInstanceId || defaultInstance?.id || undefined,
      };

      if (msg.type === "interactive" && msg.metadata) {
        sendBody.interactive = msg.metadata;
        sendBody.text = msg.metadata.body || msg.content;
      } else if (msg.type === "text") {
        sendBody.text = msg.content;
      } else {
        sendBody.mediaUrl = msg.media_url;
        if (msg.content) sendBody.caption = msg.content;
      }

      const { data, error } = await supabase.functions.invoke("uazapi-send", { body: sendBody });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const externalId = data?.key?.id || data?.messageId || null;
      await supabase.from("messages").insert({
        contact_id: contact.id,
        direction: "outbound",
        type: msg.type,
        content: msg.content,
        media_url: msg.media_url,
        status: "sent",
        external_id: externalId,
        metadata: { ...msg.metadata, source: "manual" },
      } as any);

      setTimeout(() => {
        pendingTempIdsRef.current.delete(tempId);
        setMessages((prev) => prev.map((m) => m.id === tempId ? { ...m, status: "sent" } : m));
      }, 3000);
    } catch (err: any) {
      pendingTempIdsRef.current.delete(tempId);
      setMessages((prev) => prev.map((m) => m.id === tempId ? { ...m, status: "error" } : m));
      toast.error("Erro ao reenviar: " + (err.message || "Tente novamente"));
    }
  }, [contact, selectedInstanceId, defaultInstance?.id]);

  // Delete message from WhatsApp and DB
  const handleDeleteMessage = useCallback(async (msg: Message) => {
    // Optimistic: remove from UI
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));

    try {
      // Only call UazAPI if message has external_id (was actually sent to WhatsApp)
      if (msg.external_id) {
        const { data, error } = await supabase.functions.invoke("uazapi-delete-message", {
          body: {
            messageExternalId: msg.external_id,
            instanceId: selectedInstanceId || defaultInstance?.id || undefined,
          },
        });
        if (error) throw error;
        if (data?.error) console.warn("UazAPI delete warning:", data.error);
      }

      // Delete from DB
      if (!msg.id.startsWith("temp-")) {
        await supabase.from("messages").delete().eq("id", msg.id);
      }
      toast.success(msg.external_id ? "Mensagem apagada para todos" : "Mensagem apagada");
    } catch (err: any) {
      // Restore message on failure
      setMessages((prev) => [...prev, msg].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()));
      toast.error("Erro ao apagar: " + (err.message || "Tente novamente"));
    }
  }, [selectedInstanceId, defaultInstance?.id]);

  // React to a message with emoji
  const handleReact = async (msgId: string, emoji: string) => {
    const msg = messages.find((m) => m.id === msgId);
    if (!msg) return;

    // Build reactions array (support legacy format)
    const meta = msg.metadata || {};
    const existingReactions: { emoji: string; from: string; timestamp?: string }[] =
      Array.isArray(meta.reactions) ? [...meta.reactions] : meta.reaction ? [{ emoji: meta.reaction, from: 'me' }] : [];

    // Toggle: if same emoji from 'me' already exists, remove it; otherwise add
    const myIdx = existingReactions.findIndex((r) => r.emoji === emoji && r.from === 'me');
    if (myIdx >= 0) {
      existingReactions.splice(myIdx, 1);
    } else {
      existingReactions.push({ emoji, from: 'me', timestamp: new Date().toISOString() });
    }

    const updatedMetadata = { ...meta, reactions: existingReactions };
    // Clean up legacy field
    delete updatedMetadata.reaction;

    setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, metadata: updatedMetadata } : m));

    // Update in DB
    await supabase.from("messages").update({ metadata: updatedMetadata } as any).eq("id", msgId);

    // Send via UazAPI if message has external_id (only when adding, not removing)
    if (msg.external_id && myIdx < 0) {
      try {
        await supabase.functions.invoke("uazapi-reaction", {
          body: {
            messageExternalId: msg.external_id,
            emoji,
            number: contact?.phone,
            instanceId: selectedInstanceId || defaultInstance?.id || undefined,
          },
        });
      } catch (err: any) {
        console.error("Erro ao enviar reação:", err);
      }
    }
  };

  // Send recorded audio as PTT
  const handleSendAudio = async (audioUrl: string, durationSecs: number) => {
    if (!contact) return;
    try {
      const { data, error } = await supabase.functions.invoke("uazapi-send", {
        body: { type: "ptt", number: contact.phone, mediaUrl: audioUrl, instanceId: selectedInstanceId || defaultInstance?.id || undefined },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const externalId = data?.key?.id || data?.messageId || null;
      await supabase.from("messages").insert({
        contact_id: contact.id,
        direction: "outbound",
        type: "audio",
        content: `Áudio (${Math.floor(durationSecs / 60)}:${(durationSecs % 60).toString().padStart(2, "0")})`,
        media_url: audioUrl,
        status: "sent",
        external_id: externalId,
        metadata: { source: "manual" },
      });
      await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", selectedConvId);
    } catch (err: any) {
      toast.error("Erro ao enviar áudio: " + (err.message || "Tente novamente"));
    }
  };

  // Slash command detection
  const handleMessageChange = (val: string) => {
    setNewMessage(val);
    if (val === "/") {
      setSlashMenuOpen(true);
    } else if (!val.startsWith("/")) {
      setSlashMenuOpen(false);
    }
  };

  // Check for configured LLM keys
  useEffect(() => {
    if (!user) return;
    supabase
      .from("settings")
      .select("key")
      .eq("user_id", user.id)
      .in("key", ["llm_openai", "llm_gemini"])
      .then(({ data }) => {
        if (data && data.length > 0) {
          setAiProvider(data[0].key === "llm_openai" ? "openai" : "gemini");
        }
      });
  }, [user]);

  // AI reply handler
  const handleAiReply = async (mode: "reply" | "summarize" = "reply") => {
    if (!contact || messages.length === 0) {
      toast.error("Sem mensagens para analisar");
      return;
    }
    setAiLoading(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), aiTimeoutRef.current * 1000);
    try {
      const lastMessages = messages.slice(-20).map((m) => ({
        direction: m.direction,
        content: m.content || "",
        type: m.type,
      }));

      const { data, error } = await supabase.functions.invoke("llm-reply", {
        body: { messages: lastMessages, mode },
        signal: controller.signal as any,
      });
      clearTimeout(timeoutId);

      if (error) throw error;
      if (data?.error) {
        toast.error(data.error);
        return;
      }

      if (mode === "summarize") {
        toast.success("Resumo gerado", { description: data.reply, duration: 10000 });
      } else {
        setNewMessage(data.reply || "");
        textareaRef.current?.focus();
        toast.success(`Sugestão gerada via ${data.provider === "openai" ? "OpenAI" : "Gemini"} (${data.model})`);
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      const msg = err.name === "AbortError" ? `Timeout: IA não respondeu em ${aiTimeoutRef.current}s. Aumente em Configurações → API LLM.` : (err.message || "Tente novamente");
      toast.error("Erro ao gerar resposta IA: " + msg);
    } finally {
      setAiLoading(false);
    }
  };

  // AI reply suggestions
  const fetchReplySuggestions = useCallback(async () => {
    if (!selectedConvId || !contact?.id || messages.length === 0) return;
    // Only suggest if last message is inbound
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.direction !== "inbound") return;
    
    setSuggestionsLoading(true);
    setReplySuggestions([]);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), aiTimeoutRef.current * 1000);
    try {
      const { data, error } = await supabase.functions.invoke("ai-suggestions", {
        body: { conversation_id: selectedConvId, contact_id: contact.id },
        signal: controller.signal as any,
      });
      clearTimeout(timeoutId);
      if (error) throw error;
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      setReplySuggestions(data?.suggestions || []);
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        toast.error(`Timeout: sugestões não responderam em ${aiTimeoutRef.current}s`);
      } else {
        console.error("AI suggestions error:", err);
      }
    } finally {
      setSuggestionsLoading(false);
    }
  }, [selectedConvId, contact?.id, messages]);

  // Quick replies from slash commands
  const quickReplies = [
    { cmd: "/obrigado", text: "Obrigado pelo contato! Estamos à disposição. 😊" },
    { cmd: "/aguarde", text: "Aguarde um momento, por favor. Já retorno!" },
    { cmd: "/horario", text: "Nosso horário de atendimento é de segunda a sexta, das 8h às 18h." },
    { cmd: "/preco", text: "Vou verificar essa informação e retorno em breve!" },
    { cmd: "/encerrar", text: "Ficamos felizes em ajudar! Se precisar, é só chamar. Até mais! 👋" },
  ];

  const filteredConversations = conversations.filter((c) => {
    if (filterStatus !== "all" && c.status !== filterStatus) return false;
    if (filterAgent !== "all") {
      if (filterAgent === "unassigned") {
        if (c.assigned_to) return false;
      } else if (c.assigned_to !== filterAgent) return false;
    }
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      c.contact?.name?.toLowerCase().includes(term) ||
      c.contact?.phone.includes(term) ||
      c.lastMessage?.content?.toLowerCase().includes(term)
    );
  });

  const groupMessagesByDate = (msgs: Message[]) => {
    const groups: { date: string; messages: Message[] }[] = [];
    let currentDate = "";
    for (const msg of msgs) {
      const d = new Date(msg.created_at).toLocaleDateString("pt-BR");
      if (d !== currentDate) {
        currentDate = d;
        groups.push({ date: d, messages: [msg] });
      } else {
        groups[groups.length - 1].messages.push(msg);
      }
    }
    return groups;
  };

  // Slash menu filtered
  const filteredSlashItems = newMessage.startsWith("/")
    ? [...quickReplies.filter((qr) => qr.cmd.includes(newMessage.toLowerCase())),
       ...templates.filter((t) => t.name.toLowerCase().includes(newMessage.slice(1).toLowerCase())).map((t) => ({ cmd: `/${t.name}`, text: t.content }))]
    : [];

  // Mobile: show either list or chat
  const showChat = isMobile && selectedConvId;
  const showList = !isMobile || !selectedConvId;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-xl md:text-2xl font-bold">Inbox</h1>
          <p className="text-xs md:text-sm text-muted-foreground">Atenda seus clientes em tempo real</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setGlobalSearchOpen(true)}>
            <SearchCheck className="h-4 w-4" />
            <span className="hidden sm:inline">Pesquisar mensagens</span>
          </Button>
          <ToggleGroup type="single" value={viewMode} onValueChange={(v) => { if (v) { setViewMode(v as "list" | "kanban"); localStorage.setItem("inbox_view_mode", v); } }} className="border border-border rounded-lg p-0.5">
            <ToggleGroupItem value="list" aria-label="Visão lista" className="h-8 w-8 p-0 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
              <List className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="kanban" aria-label="Visão kanban" className="h-8 w-8 p-0 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
              <Kanban className="h-4 w-4" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {viewMode === "kanban" ? (
        <KanbanView
          conversations={filteredConversations}
          onSelectConversation={(id) => { setSelectedConvId(id); setViewMode("list"); }}
          onReload={loadConversations}
        />
      ) : (
      <div className={cn(
        "grid h-[calc(100vh-220px)] gap-4",
        isMobile ? "grid-cols-1" : "grid-cols-12"
      )}>
        {/* Conversation List */}
        {showList && (
        <Card className={cn("flex flex-col overflow-hidden", !isMobile && "col-span-3")}>
          <div className="border-b border-border">
            <div className="flex overflow-x-auto">
              {[
                { value: "all", label: "Todas" },
                { value: "open", label: "Abertas" },
                { value: "in_progress", label: "Atendendo" },
                { value: "waiting", label: "Aguardando" },
                { value: "resolved", label: "Resolvidas" },
              ].map((s) => {
                const count = s.value === "all" ? conversations.length : conversations.filter((c) => c.status === s.value).length;
                return (
                  <button
                    key={s.value}
                    onClick={() => setFilterStatus(s.value)}
                    className={cn(
                      "flex-1 px-2 py-2 text-[11px] font-medium transition-colors border-b-2 whitespace-nowrap",
                      filterStatus === s.value ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {s.label} {count > 0 && <span className="ml-0.5 opacity-60">({count})</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="border-b border-border p-2 space-y-1.5">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar..." className="pl-8 h-8 text-sm" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
            {agentProfiles.length > 0 && (
              <select
                value={filterAgent}
                onChange={(e) => setFilterAgent(e.target.value)}
                className="w-full h-7 rounded-md border border-input bg-background px-2 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">Todos os atendentes</option>
                <option value="unassigned">Sem atendente</option>
                {agentProfiles.map((a) => (
                  <option key={a.user_id} value={a.user_id}>{a.name}</option>
                ))}
              </select>
            )}
          </div>
          <ScrollArea className="flex-1">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                {searchTerm ? "Nenhuma conversa encontrada" : "Nenhuma conversa ainda"}
              </div>
            ) : (
              filteredConversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => setSelectedConvId(conv.id)}
                  className={cn(
                    "flex w-full items-center gap-3 border-b border-border px-3 py-3 text-left transition-colors hover:bg-accent",
                    selectedConvId === conv.id && "bg-accent"
                  )}
                >
                  <Avatar className="h-10 w-10 shrink-0">
                    {conv.contact?.profile_picture && <AvatarImage src={conv.contact.profile_picture} />}
                    <AvatarFallback className="bg-primary/10 text-primary text-xs">
                      {getInitials(conv.contact?.name || null, conv.contact?.phone || "")}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium truncate">
                        {conv.contact?.name || conv.contact?.phone || "Desconhecido"}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {conv.last_message_at ? formatTime(conv.last_message_at) : ""}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {conv.lastMessage?.content || (conv.lastMessage?.type !== "text" ? `📎 ${conv.lastMessage?.type}` : "")}
                    </p>
                  </div>
                   <div className="flex flex-col items-end gap-1 shrink-0">
                    {(conv.unread_count ?? 0) > 0 && (
                      <Badge className="h-5 min-w-[20px] rounded-full p-0 text-xs flex items-center justify-center">
                        {conv.unread_count}
                      </Badge>
                    )}
                    {conv.assigned_to && ["waiting", "in_progress"].includes(conv.status) && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10">
                        IA pausada
                      </Badge>
                    )}
                    {(conv.score ?? 0) > 0 && (
                      <span className="text-[10px] font-mono text-primary/70 font-semibold">{conv.score}pts</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </ScrollArea>
        </Card>
        )}

        {/* Chat Area */}
        {(!isMobile || showChat) && (
        <Card className={cn("flex flex-col overflow-hidden", !isMobile && "col-span-6")}>
          {!selectedConv ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Phone className="mx-auto h-12 w-12 mb-3 opacity-30" />
                <p className="text-sm">Selecione uma conversa para começar</p>
              </div>
            </div>
          ) : (
            <>
              {/* Chat Header */}
              <div className="border-b border-border px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {isMobile && (
                      <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={() => setSelectedConvId(null)}>
                        <ArrowLeft className="h-4 w-4" />
                      </Button>
                    )}
                    <Avatar className="h-8 w-8">
                      {contact?.profile_picture && <AvatarImage src={contact.profile_picture} />}
                      <AvatarFallback className="bg-primary/10 text-primary text-xs">
                        {getInitials(contact?.name || null, contact?.phone || "")}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{contact?.name || contact?.phone || "Desconhecido"}</p>
                        {selectedConv.assigned_to && ["waiting", "in_progress"].includes(selectedConv.status) && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10 gap-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                            Atendimento humano · IA pausada
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{contact?.phone}</p>
                    </div>
                  </div>
                  {instances.length > 1 && (
                    <InstanceSelector
                      value={selectedInstanceId}
                      onChange={setSelectedInstanceId}
                      className="min-w-[140px]"
                    />
                  )}
                </div>
              </div>

              {/* Messages */}
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-1">
                  {groupMessagesByDate(messages).map((group) => (
                    <div key={group.date}>
                      <div className="flex items-center justify-center my-3">
                        <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">{group.date}</span>
                      </div>
                      {group.messages.map((msg) => (
                        <MessageBubble key={msg.id} msg={msg} onReact={handleReact} onRetry={handleRetry} onDelete={handleDeleteMessage} />
                      ))}
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {/* AI Funnel Suggestion Banner */}
              {aiSuggestion && (
                <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 animate-in slide-in-from-bottom-2">
                  <Brain className="h-4 w-4 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">
                      IA sugere mover para{" "}
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2.5 w-2.5 rounded-full inline-block" style={{ backgroundColor: aiSuggestion.stage_color }} />
                        <strong>{aiSuggestion.stage_name}</strong>
                      </span>
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">{aiSuggestion.reason} • Intenção: {aiSuggestion.intent}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 text-xs shrink-0"
                    onClick={async () => {
                      if (selectedConvId) {
                        await supabase.from("conversations").update({ funnel_stage_id: aiSuggestion.stage_id }).eq("id", selectedConvId);
                        toast.success(`Movido para "${aiSuggestion.stage_name}"`);
                        setAiSuggestion(null);
                        loadConversations();
                      }
                    }}
                  >
                    Aceitar
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs shrink-0" onClick={() => setAiSuggestion(null)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}

              {/* Slash command menu */}
              {slashMenuOpen && filteredSlashItems.length > 0 && (
                <div className="border-t border-border bg-popover shadow-lg">
                  <ScrollArea className="max-h-40">
                    {filteredSlashItems.map((item, i) => (
                      <button
                        key={i}
                        className="w-full text-left px-4 py-2 hover:bg-accent transition-colors border-b border-border last:border-0"
                        onClick={() => {
                          let text = item.text;
                          if (contact) {
                            text = text.replace(/\{\{nome\}\}/gi, contact.name || contact.phone);
                            text = text.replace(/\{\{telefone\}\}/gi, contact.phone);
                          }
                          setNewMessage(text);
                          setSlashMenuOpen(false);
                          textareaRef.current?.focus();
                        }}
                      >
                        <p className="text-sm font-medium text-primary">{item.cmd}</p>
                        <p className="text-xs text-muted-foreground truncate">{item.text}</p>
                      </button>
                    ))}
                  </ScrollArea>
                </div>
              )}

              {/* AI Reply Suggestions */}
              {(replySuggestions.length > 0 || suggestionsLoading) && (
                <div className="mx-3 mb-2 flex flex-wrap items-center gap-2 animate-in slide-in-from-bottom-2">
                  <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
                  {suggestionsLoading ? (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Gerando sugestões...
                    </div>
                  ) : (
                    <>
                      {replySuggestions.map((s, i) => (
                        <div key={i} className="flex items-center gap-0.5 animate-in fade-in">
                          <button
                            onClick={() => {
                              setNewMessage(s.text);
                              setReplySuggestions([]);
                              textareaRef.current?.focus();
                            }}
                            className="rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs text-foreground hover:bg-primary/10 hover:border-primary/40 transition-colors max-w-[220px] truncate"
                            title={s.text}
                          >
                            <span className="font-medium text-primary mr-1">{s.label}:</span>
                            {s.text}
                          </button>
                          <button
                            onClick={async () => {
                              if (!user || !selectedConvId || !contact) return;
                              await supabase.from("ai_feedback").insert({
                                user_id: user.id,
                                conversation_id: selectedConvId,
                                contact_id: contact.id,
                                suggestion_text: s.text,
                                suggestion_label: s.label,
                                rating: "positive",
                              } as any);
                              toast.success("Feedback salvo 👍");
                            }}
                            className="p-0.5 text-muted-foreground hover:text-green-600 transition-colors"
                            title="Boa sugestão"
                          >
                            <ThumbsUp className="h-3 w-3" />
                          </button>
                          <button
                            onClick={async () => {
                              if (!user || !selectedConvId || !contact) return;
                              await supabase.from("ai_feedback").insert({
                                user_id: user.id,
                                conversation_id: selectedConvId,
                                contact_id: contact.id,
                                suggestion_text: s.text,
                                suggestion_label: s.label,
                                rating: "negative",
                              } as any);
                              toast.success("Feedback salvo 👎");
                              setReplySuggestions((prev) => prev.filter((_, idx) => idx !== i));
                            }}
                            className="p-0.5 text-muted-foreground hover:text-red-500 transition-colors"
                            title="Sugestão ruim"
                          >
                            <ThumbsDown className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                      <button onClick={() => setReplySuggestions([])} className="text-muted-foreground hover:text-foreground">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Message Input */}
              <div className="border-t border-border p-3">
                {isNoteMode && (
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <Badge variant="outline" className="text-warning border-warning/30 bg-warning/10 gap-1">
                      <StickyNote className="h-3 w-3" /> Nota interna — não será enviada ao cliente
                    </Badge>
                    <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setIsNoteMode(false)}>
                      Cancelar
                    </Button>
                  </div>
                )}
                {mediaAttachment && (
                  <AttachmentPreview
                    attachment={mediaAttachment}
                    onRemove={() => setMediaAttachment(null)}
                    uploading={mediaUploading}
                  />
                )}
                <div className="flex items-end gap-2">
                  <div className="flex gap-0.5">
                    <MediaUploader
                      attachment={mediaAttachment}
                      onAttach={setMediaAttachment}
                      onRemove={() => setMediaAttachment(null)}
                      disabled={sending || isNoteMode}
                    />
                    <Popover open={templateOpen} onOpenChange={setTemplateOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="ghost" size="icon" className="shrink-0 h-9 w-9" title="Templates">
                          <LayoutTemplate className="h-4 w-4" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-72 p-0" align="start" side="top">
                        <div className="p-2 border-b border-border">
                          <Input placeholder="Buscar template..." value={templateSearch} onChange={(e) => setTemplateSearch(e.target.value)} className="h-8 text-sm" />
                        </div>
                        <ScrollArea className="max-h-48">
                          {templates
                            .filter((t) => !templateSearch || t.name.toLowerCase().includes(templateSearch.toLowerCase()) || t.content.toLowerCase().includes(templateSearch.toLowerCase()))
                            .map((t) => (
                              <button
                                key={t.id}
                                className="w-full text-left px-3 py-2 hover:bg-accent transition-colors border-b border-border last:border-0"
                                onClick={() => {
                                  let text = t.content;
                                  if (contact) {
                                    text = text.replace(/\{\{nome\}\}/gi, contact.name || contact.phone);
                                    text = text.replace(/\{\{telefone\}\}/gi, contact.phone);
                                  }
                                  setNewMessage(text);
                                  setTemplateOpen(false);
                                  setTemplateSearch("");
                                }}
                              >
                                <p className="text-sm font-medium truncate">{t.name}</p>
                                <p className="text-xs text-muted-foreground truncate">{t.content}</p>
                              </button>
                            ))}
                        </ScrollArea>
                      </PopoverContent>
                    </Popover>
                    <Button
                      variant={isNoteMode ? "default" : "ghost"}
                      size="icon"
                      className={cn("shrink-0 h-9 w-9", isNoteMode && "bg-warning text-warning-foreground hover:bg-warning/90")}
                      title="Nota interna"
                      onClick={() => setIsNoteMode(!isNoteMode)}
                    >
                      <StickyNote className="h-4 w-4" />
                    </Button>
                    <Button
                      variant={interactiveMsg.type !== "none" ? "default" : "ghost"}
                      size="icon"
                      className="shrink-0 h-9 w-9"
                      title="Mensagem interativa (botões, listas)"
                      onClick={() => setInteractiveOpen(true)}
                      disabled={sending || isNoteMode}
                    >
                      <MousePointerClick className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 h-9 w-9 text-primary hover:text-primary"
                      title="Sugestões de resposta com IA"
                      onClick={fetchReplySuggestions}
                      disabled={suggestionsLoading || messages.length === 0}
                    >
                      {suggestionsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
                    </Button>
                    {aiProvider && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="shrink-0 h-9 w-9 text-primary hover:text-primary"
                          title="Sugerir resposta com IA"
                          onClick={() => handleAiReply("reply")}
                          disabled={aiLoading || messages.length === 0}
                        >
                          {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="shrink-0 h-9 w-9"
                          title="Resumir conversa com IA"
                          onClick={() => handleAiReply("summarize")}
                          disabled={aiLoading || messages.length === 0}
                        >
                          <SummarizeIcon className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                  <Textarea
                    ref={textareaRef}
                    placeholder={isNoteMode ? "Escreva uma nota interna..." : mediaAttachment ? "Legenda (opcional)..." : "Digite / para atalhos ou sua mensagem..."}
                    value={newMessage}
                    onChange={(e) => handleMessageChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className={cn(
                      "min-h-[40px] max-h-[120px] resize-none flex-1",
                      isNoteMode && "border-warning/30 focus-visible:ring-warning"
                    )}
                    rows={1}
                  />
                  {(newMessage.trim() || mediaAttachment || isNoteMode) ? (
                    <Button
                      size="icon"
                      className={cn("shrink-0", isNoteMode && "bg-warning hover:bg-warning/90")}
                      onClick={handleSend}
                      disabled={(!newMessage.trim() && !mediaAttachment) || sending}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  ) : (
                    <AudioRecorder onSend={handleSendAudio} disabled={sending} />
                  )}
                </div>
                {interactiveMsg.type !== "none" && (
                  <div className="flex items-center gap-2 mt-1.5 px-1">
                    <Badge variant="outline" className="text-xs text-primary border-primary/30 bg-primary/5 gap-1">
                      <MousePointerClick className="h-3 w-3" />
                      Mensagem interativa: {interactiveMsg.type === "buttons" ? "Botões" : interactiveMsg.type === "list" ? "Lista" : "CTA"}
                    </Badge>
                    <Button variant="ghost" size="sm" className="h-5 text-[10px]" onClick={() => setInteractiveMsg(getDefaultInteractive())}>
                      Remover
                    </Button>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground mt-1.5 px-1">
                  <kbd className="rounded bg-muted px-1 font-mono">📎</kbd> anexar • <kbd className="rounded bg-muted px-1 font-mono">🎤</kbd> áudio • <kbd className="rounded bg-muted px-1 font-mono">/</kbd> atalhos • <kbd className="rounded bg-muted px-1 font-mono">🔘</kbd> interativo • <kbd className="rounded bg-muted px-1 font-mono">Enter</kbd> enviar{aiProvider && " • ✨ IA"}
                </p>
              </div>

              {/* Interactive Message Dialog */}
              <Dialog open={interactiveOpen} onOpenChange={setInteractiveOpen}>
                <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Mensagem Interativa</DialogTitle>
                  </DialogHeader>
                  <InteractiveMessageBuilder
                    value={interactiveMsg}
                    onChange={setInteractiveMsg}
                  />
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => { setInteractiveMsg(getDefaultInteractive()); setInteractiveOpen(false); }}>
                      Limpar
                    </Button>
                    <Button onClick={() => {
                      if (interactiveMsg.type !== "none" && interactiveMsg.body) {
                        setNewMessage(interactiveMsg.body);
                      }
                      setInteractiveOpen(false);
                    }}>
                      Confirmar
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </>
          )}
        </Card>
        )}

        {/* Contact Panel - hidden on mobile */}
        {!isMobile && (
        <Card className="col-span-3 overflow-hidden">
          <ContactPanel
            contact={contact || null}
            conversationId={selectedConvId}
            conversationStatus={selectedConv?.status || "open"}
            conversationNotes={selectedConv?.notes || null}
            assignedTo={selectedConv?.assigned_to || null}
            contactTags={contactTags}
            score={selectedConv?.score}
            onReload={loadConversations}
          />
        </Card>
        )}
      </div>
      )}
      <GlobalMessageSearch
        open={globalSearchOpen}
        onOpenChange={setGlobalSearchOpen}
        onNavigate={(conversationId, messageId) => {
          setSelectedConvId(conversationId);
          setViewMode("list");
          setHighlightMessageId(messageId);
          // Scroll to message after it loads
          setTimeout(() => {
            const el = document.getElementById(`msg-${messageId}`);
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "center" });
              el.classList.add("ring-2", "ring-primary", "ring-offset-2", "rounded-lg");
              setTimeout(() => {
                el.classList.remove("ring-2", "ring-primary", "ring-offset-2", "rounded-lg");
                setHighlightMessageId(null);
              }, 3000);
            }
          }, 600);
        }}
      />
    </div>
  );
};

export default InboxPage;
