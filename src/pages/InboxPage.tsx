import { useState, useEffect, useRef, useCallback } from "react";
import { Search, Send, Paperclip, Phone, MoreVertical, CheckCheck, Check, Clock, AlertCircle, ImageIcon, FileText, Mic, LayoutTemplate, Kanban, List } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import KanbanView from "@/components/inbox/KanbanView";

interface Contact {
  id: string;
  name: string | null;
  phone: string;
  profile_picture: string | null;
  about: string | null;
  is_blocked: boolean | null;
}

interface Conversation {
  id: string;
  contact_id: string;
  status: string;
  unread_count: number | null;
  last_message_at: string | null;
  notes: string | null;
  contact?: Contact;
  lastMessage?: Message;
}

interface Message {
  id: string;
  contact_id: string | null;
  direction: string;
  type: string;
  content: string | null;
  media_url: string | null;
  status: string | null;
  created_at: string;
  external_id: string | null;
}

interface Tag {
  id: string;
  name: string;
  color: string;
}

const statusIcon = (status: string | null) => {
  switch (status) {
    case 'read': case 'played': return <CheckCheck className="h-3.5 w-3.5 text-info" />;
    case 'delivered': return <CheckCheck className="h-3.5 w-3.5 text-muted-foreground" />;
    case 'sent': return <Check className="h-3.5 w-3.5 text-muted-foreground" />;
    case 'error': case 'failed': return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
    default: return <Clock className="h-3 w-3 text-muted-foreground" />;
  }
};

const typeIcon = (type: string) => {
  switch (type) {
    case 'image': return <ImageIcon className="h-3.5 w-3.5" />;
    case 'document': return <FileText className="h-3.5 w-3.5" />;
    case 'audio': case 'ptt': return <Mic className="h-3.5 w-3.5" />;
    default: return null;
  }
};

const formatTime = (dateStr: string) => {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const oneDay = 86400000;

  if (diff < oneDay && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  if (diff < 2 * oneDay) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};

const formatMessageTime = (dateStr: string) =>
  new Date(dateStr).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

const getInitials = (name: string | null, phone: string) => {
  if (name) return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  return phone.slice(-2);
};

const InboxPage = () => {
  const { user } = useAuth();
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
  const [viewMode, setViewMode] = useState<"list" | "kanban">("list");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const selectedConv = conversations.find((c) => c.id === selectedConvId);
  const contact = selectedConv?.contact;

  // Load conversations with contacts - optimized batch query
  const loadConversations = useCallback(async () => {
    const { data: convs } = await supabase
      .from("conversations")
      .select("*")
      .order("last_message_at", { ascending: false });

    if (!convs || convs.length === 0) {
      setConversations([]);
      return;
    }

    // Batch load contacts
    const contactIds = [...new Set(convs.map((c) => c.contact_id))];
    const { data: contacts } = await supabase
      .from("contacts")
      .select("*")
      .in("id", contactIds);

    const contactMap = new Map((contacts || []).map((c) => [c.id, c]));

    // Batch load last messages - get recent messages for all contacts at once
    const { data: allMessages } = await supabase
      .from("messages")
      .select("*")
      .in("contact_id", contactIds)
      .order("created_at", { ascending: false })
      .limit(contactIds.length * 2); // rough limit

    // Build a map of contact_id -> last message
    const lastMsgMap = new Map<string, Message>();
    for (const msg of (allMessages || []) as Message[]) {
      if (msg.contact_id && !lastMsgMap.has(msg.contact_id)) {
        lastMsgMap.set(msg.contact_id, msg);
      }
    }

    const enriched: Conversation[] = convs.map((conv) => ({
      ...conv,
      unread_count: conv.unread_count ?? 0,
      contact: contactMap.get(conv.contact_id) as Contact | undefined,
      lastMessage: lastMsgMap.get(conv.contact_id),
    }));

    setConversations(enriched);
  }, []);

  // Load messages for selected conversation
  const loadMessages = useCallback(async (contactId: string) => {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: true })
      .limit(200);

    setMessages((data as Message[]) || []);
  }, []);

  // Load tags for contact
  const loadContactTags = useCallback(async (contactId: string) => {
    const { data } = await supabase
      .from("contact_tags")
      .select("tag_id")
      .eq("contact_id", contactId);

    if (data && data.length > 0) {
      const tagIds = data.map((ct) => ct.tag_id);
      const { data: tags } = await supabase
        .from("tags")
        .select("*")
        .in("id", tagIds);
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

  // Initial load
  useEffect(() => {
    setLoading(true);
    loadConversations().finally(() => setLoading(false));
  }, [loadConversations]);

  // Load messages when conversation selected
  useEffect(() => {
    if (!selectedConv?.contact_id) return;
    loadMessages(selectedConv.contact_id);
    loadContactTags(selectedConv.contact_id);

    // Mark as read
    if (selectedConv.unread_count && selectedConv.unread_count > 0) {
      supabase
        .from("conversations")
        .update({ unread_count: 0 })
        .eq("id", selectedConv.id)
        .then(() => {
          setConversations((prev) =>
            prev.map((c) => (c.id === selectedConv.id ? { ...c, unread_count: 0 } : c))
          );
        });
    }
  }, [selectedConvId, selectedConv?.contact_id]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Debounced conversation reload
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

  // Realtime subscriptions
  useEffect(() => {
    const channel = supabase
      .channel("inbox-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new as Message;
          // Play sound for inbound messages
          if (msg.direction === "inbound") {
            playNotificationSound();
          }
          // If it's the current conversation, add to messages instantly
          if (selectedConv && msg.contact_id === selectedConv.contact_id) {
            setMessages((prev) => {
              if (prev.find((m) => m.id === msg.id)) return prev;
              return [...prev, msg];
            });
          }
          // Debounced refresh of conversation list
          debouncedReload();
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new as Message;
          setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        () => debouncedReload()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (reloadTimeoutRef.current) clearTimeout(reloadTimeoutRef.current);
    };
  }, [selectedConv?.contact_id, debouncedReload]);

  // Send message
  const handleSend = async () => {
    if (!newMessage.trim() || !contact || sending) return;

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("uazapi-send", {
        body: { type: "text", number: contact.phone, text: newMessage.trim() },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Insert outbound message locally
      const externalId = data?.key?.id || data?.messageId || null;
      await supabase.from("messages").insert({
        contact_id: contact.id,
        direction: "outbound",
        type: "text",
        content: newMessage.trim(),
        status: "sent",
        external_id: externalId,
      });

      // Update conversation
      await supabase
        .from("conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", selectedConvId);

      setNewMessage("");
    } catch (err: any) {
      toast.error("Erro ao enviar: " + (err.message || "Tente novamente"));
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const filteredConversations = conversations.filter((c) => {
    if (filterStatus !== "all" && c.status !== filterStatus) return false;
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">Inbox</h1>
          <p className="text-sm text-muted-foreground">Atenda seus clientes em tempo real</p>
        </div>
        <ToggleGroup type="single" value={viewMode} onValueChange={(v) => v && setViewMode(v as "list" | "kanban")} className="border border-border rounded-lg p-0.5">
          <ToggleGroupItem value="list" aria-label="Visão lista" className="h-8 w-8 p-0 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
            <List className="h-4 w-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="kanban" aria-label="Visão kanban" className="h-8 w-8 p-0 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
            <Kanban className="h-4 w-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {viewMode === "kanban" ? (
        <KanbanView
          conversations={filteredConversations}
          onSelectConversation={(id) => {
            setSelectedConvId(id);
            setViewMode("list");
          }}
          onReload={loadConversations}
        />
      ) : (
      <div className="grid h-[calc(100vh-220px)] grid-cols-12 gap-4">
        {/* Conversation List */}
        <Card className="col-span-3 flex flex-col overflow-hidden">
          <div className="border-b border-border">
            <div className="flex overflow-x-auto">
              {[
                { value: "all", label: "Todas" },
                { value: "open", label: "Abertas" },
                { value: "in_progress", label: "Atendendo" },
                { value: "waiting", label: "Aguardando" },
                { value: "resolved", label: "Resolvidas" },
              ].map((s) => {
                const count = s.value === "all"
                  ? conversations.length
                  : conversations.filter((c) => c.status === s.value).length;
                return (
                  <button
                    key={s.value}
                    onClick={() => setFilterStatus(s.value)}
                    className={cn(
                      "flex-1 px-2 py-2 text-[11px] font-medium transition-colors border-b-2 whitespace-nowrap",
                      filterStatus === s.value
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {s.label} {count > 0 && <span className="ml-0.5 opacity-60">({count})</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar..."
                className="pl-8 h-8 text-sm"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
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
                    {conv.contact?.profile_picture && (
                      <AvatarImage src={conv.contact.profile_picture} />
                    )}
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
                    <div className="flex items-center gap-1">
                      {conv.lastMessage?.direction === "outbound" && (
                        <span className="shrink-0">{statusIcon(conv.lastMessage.status)}</span>
                      )}
                      {conv.lastMessage && typeIcon(conv.lastMessage.type) && (
                        <span className="shrink-0 text-muted-foreground">
                          {typeIcon(conv.lastMessage.type)}
                        </span>
                      )}
                      <p className="text-xs text-muted-foreground truncate">
                        {conv.lastMessage?.content || (conv.lastMessage?.type !== "text" ? `📎 ${conv.lastMessage?.type}` : "")}
                      </p>
                    </div>
                  </div>
                  {(conv.unread_count ?? 0) > 0 && (
                    <Badge className="h-5 min-w-[20px] shrink-0 rounded-full p-0 text-xs flex items-center justify-center">
                      {conv.unread_count}
                    </Badge>
                  )}
                </button>
              ))
            )}
          </ScrollArea>
        </Card>

        {/* Chat Area */}
        <Card className="col-span-6 flex flex-col overflow-hidden">
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
                    <Avatar className="h-8 w-8">
                      {contact?.profile_picture && <AvatarImage src={contact.profile_picture} />}
                      <AvatarFallback className="bg-primary/10 text-primary text-xs">
                        {getInitials(contact?.name || null, contact?.phone || "")}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">
                        {contact?.name || contact?.phone || "Desconhecido"}
                      </p>
                      <p className="text-xs text-muted-foreground">{contact?.phone}</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Messages */}
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-1">
                  {groupMessagesByDate(messages).map((group) => (
                    <div key={group.date}>
                      <div className="flex items-center justify-center my-3">
                        <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                          {group.date}
                        </span>
                      </div>
                      {group.messages.map((msg) => (
                        <div
                          key={msg.id}
                          className={cn(
                            "flex mb-1",
                            msg.direction === "outbound" ? "justify-end" : "justify-start"
                          )}
                        >
                          <div
                            className={cn(
                              "max-w-[75%] rounded-2xl px-3.5 py-2",
                              msg.direction === "outbound"
                                ? "bg-primary text-primary-foreground rounded-br-md"
                                : "bg-muted rounded-bl-md"
                            )}
                          >
                            {msg.type !== "text" && msg.media_url && (
                              <div className="mb-1">
                                {msg.type === "image" ? (
                                  <img
                                    src={msg.media_url}
                                    alt="Imagem"
                                    className="max-w-full rounded-lg"
                                  />
                                ) : (
                                  <div className="flex items-center gap-2 text-xs opacity-75">
                                    {typeIcon(msg.type)}
                                    <span>{msg.type}</span>
                                  </div>
                                )}
                              </div>
                            )}
                            {msg.content && <p className="text-sm whitespace-pre-wrap">{msg.content}</p>}
                            <div
                              className={cn(
                                "flex items-center justify-end gap-1 mt-0.5",
                                msg.direction === "outbound"
                                  ? "text-primary-foreground/60"
                                  : "text-muted-foreground"
                              )}
                            >
                              <span className="text-[10px]">{formatMessageTime(msg.created_at)}</span>
                              {msg.direction === "outbound" && statusIcon(msg.status)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {/* Message Input */}
              <div className="border-t border-border p-3">
                <div className="flex items-end gap-2">
                  <Popover open={templateOpen} onOpenChange={setTemplateOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="icon" className="shrink-0" title="Usar template">
                        <LayoutTemplate className="h-4 w-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-0" align="start" side="top">
                      <div className="p-2 border-b border-border">
                        <Input
                          placeholder="Buscar template..."
                          value={templateSearch}
                          onChange={(e) => setTemplateSearch(e.target.value)}
                          className="h-8 text-sm"
                        />
                      </div>
                      <ScrollArea className="max-h-48">
                        {templates
                          .filter((t) => !templateSearch || t.name.toLowerCase().includes(templateSearch.toLowerCase()) || t.content.toLowerCase().includes(templateSearch.toLowerCase()))
                          .map((t) => (
                            <button
                              key={t.id}
                              className="w-full text-left px-3 py-2 hover:bg-accent transition-colors border-b border-border last:border-0"
                              onClick={() => {
                                // Replace variables with contact data
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
                        {templates.filter((t) => !templateSearch || t.name.toLowerCase().includes(templateSearch.toLowerCase())).length === 0 && (
                          <p className="p-3 text-xs text-muted-foreground text-center">Nenhum template encontrado</p>
                        )}
                      </ScrollArea>
                    </PopoverContent>
                  </Popover>
                  <Textarea
                    placeholder="Digite sua mensagem..."
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="min-h-[40px] max-h-[120px] resize-none flex-1"
                    rows={1}
                  />
                  <Button
                    size="icon"
                    className="shrink-0"
                    onClick={handleSend}
                    disabled={!newMessage.trim() || sending}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>

        {/* Contact Details */}
        <Card className="col-span-3 overflow-y-auto p-4">
          {!contact ? (
            <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
              Selecione uma conversa
            </div>
          ) : (
            <>
              <div className="flex flex-col items-center text-center">
                <Avatar className="h-16 w-16">
                  {contact.profile_picture && <AvatarImage src={contact.profile_picture} />}
                  <AvatarFallback className="bg-primary/10 text-primary text-lg">
                    {getInitials(contact.name, contact.phone)}
                  </AvatarFallback>
                </Avatar>
                <h3 className="mt-3 font-heading font-semibold">
                  {contact.name || "Sem nome"}
                </h3>
                <p className="text-sm text-muted-foreground">{contact.phone}</p>
                {contact.about && (
                  <p className="mt-1 text-xs text-muted-foreground italic">{contact.about}</p>
                )}
              </div>

              <div className="mt-6 space-y-4">
                {/* Tags */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase">Tags</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {contactTags.length > 0 ? (
                      contactTags.map((tag) => (
                        <Badge
                          key={tag.id}
                          variant="secondary"
                          style={{
                            backgroundColor: `${tag.color}20`,
                            color: tag.color,
                          }}
                        >
                          {tag.name}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">Sem tags</span>
                    )}
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase">Notas</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedConv?.notes || "Nenhuma nota adicionada."}
                  </p>
                </div>

                {/* Status */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase">Status</p>
                  <Badge
                    variant="secondary"
                    className={cn(
                      "mt-1",
                      selectedConv?.status === "open" && "bg-success/15 text-success",
                      selectedConv?.status === "in_progress" && "bg-info/15 text-info",
                      selectedConv?.status === "resolved" && "bg-muted text-muted-foreground",
                      selectedConv?.status === "waiting" && "bg-warning/15 text-warning"
                    )}
                  >
                    {selectedConv?.status === "open" ? "Aberta" : selectedConv?.status === "in_progress" ? "Em Atendimento" : selectedConv?.status === "resolved" ? "Resolvida" : "Aguardando"}
                  </Badge>
                </div>

                {/* Actions */}
                <div className="space-y-2 pt-2">
                  <Select
                    value={selectedConv?.status || "open"}
                    onValueChange={async (newStatus) => {
                      await supabase
                        .from("conversations")
                        .update({ status: newStatus })
                        .eq("id", selectedConvId);
                      const labels: Record<string, string> = { open: "Aberta", in_progress: "Em Atendimento", waiting: "Aguardando", resolved: "Resolvida" };
                      toast.success(`Status: ${labels[newStatus]}`);
                      loadConversations();
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Aberta</SelectItem>
                      <SelectItem value="in_progress">Em Atendimento</SelectItem>
                      <SelectItem value="waiting">Aguardando</SelectItem>
                      <SelectItem value="resolved">Resolvida</SelectItem>
                    </SelectContent>
                  </Select>
                  {contact.is_blocked ? (
                    <Button
                      variant="outline"
                      className="w-full"
                      size="sm"
                      onClick={async () => {
                        await supabase
                          .from("contacts")
                          .update({ is_blocked: false })
                          .eq("id", contact.id);
                        toast.success("Contato desbloqueado");
                        loadConversations();
                      }}
                    >
                      Desbloquear
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      className="w-full text-destructive"
                      size="sm"
                      onClick={async () => {
                        await supabase
                          .from("contacts")
                          .update({ is_blocked: true })
                          .eq("id", contact.id);
                        toast.success("Contato bloqueado");
                        loadConversations();
                      }}
                    >
                      Bloquear
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
      )}
    </div>
  );
};

export default InboxPage;
