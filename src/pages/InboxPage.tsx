import { useState, useEffect, useRef, useCallback } from "react";
import { Search, Send, Phone, MoreVertical, Kanban, List, StickyNote, LayoutTemplate, Slash } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import MessageBubble from "@/components/inbox/MessageBubble";
import ContactPanel from "@/components/inbox/ContactPanel";
import type { Message } from "@/components/inbox/MessageBubble";

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
  const [isNoteMode, setIsNoteMode] = useState(false);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedConv = conversations.find((c) => c.id === selectedConvId);
  const contact = selectedConv?.contact;

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

  useEffect(() => {
    setLoading(true);
    loadConversations().finally(() => setLoading(false));
  }, [loadConversations]);

  useEffect(() => {
    if (!selectedConv?.contact_id) return;
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
        if (msg.direction === "inbound") {
          const soundEnabled = localStorage.getItem("notification_sound_enabled") !== "false";
          if (soundEnabled) playNotificationSound();
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
    if (!newMessage.trim() || !contact || sending) return;

    if (isNoteMode) {
      // Save as internal note
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

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("uazapi-send", {
        body: { type: "text", number: contact.phone, text: newMessage.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const externalId = data?.key?.id || data?.messageId || null;
      await supabase.from("messages").insert({
        contact_id: contact.id,
        direction: "outbound",
        type: "text",
        content: newMessage.trim(),
        status: "sent",
        external_id: externalId,
      });
      await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", selectedConvId);
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

  // Slash command detection
  const handleMessageChange = (val: string) => {
    setNewMessage(val);
    if (val === "/") {
      setSlashMenuOpen(true);
    } else if (!val.startsWith("/")) {
      setSlashMenuOpen(false);
    }
  };

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
          onSelectConversation={(id) => { setSelectedConvId(id); setViewMode("list"); }}
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
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar..." className="pl-8 h-8 text-sm" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
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
                      <p className="text-sm font-medium">{contact?.name || contact?.phone || "Desconhecido"}</p>
                      <p className="text-xs text-muted-foreground">{contact?.phone}</p>
                    </div>
                  </div>
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
                        <MessageBubble key={msg.id} msg={msg} />
                      ))}
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

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
                <div className="flex items-end gap-2">
                  <div className="flex gap-0.5">
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
                  </div>
                  <Textarea
                    ref={textareaRef}
                    placeholder={isNoteMode ? "Escreva uma nota interna..." : "Digite / para atalhos ou sua mensagem..."}
                    value={newMessage}
                    onChange={(e) => handleMessageChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className={cn(
                      "min-h-[40px] max-h-[120px] resize-none flex-1",
                      isNoteMode && "border-warning/30 focus-visible:ring-warning"
                    )}
                    rows={1}
                  />
                  <Button
                    size="icon"
                    className={cn("shrink-0", isNoteMode && "bg-warning hover:bg-warning/90")}
                    onClick={handleSend}
                    disabled={!newMessage.trim() || sending}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5 px-1">
                  Digite <kbd className="rounded bg-muted px-1 font-mono">/</kbd> para respostas rápidas • <kbd className="rounded bg-muted px-1 font-mono">Enter</kbd> para enviar
                </p>
              </div>
            </>
          )}
        </Card>

        {/* Contact Panel */}
        <Card className="col-span-3 overflow-hidden">
          <ContactPanel
            contact={contact || null}
            conversationId={selectedConvId}
            conversationStatus={selectedConv?.status || "open"}
            conversationNotes={selectedConv?.notes || null}
            assignedTo={selectedConv?.assigned_to || null}
            contactTags={contactTags}
            onReload={loadConversations}
          />
        </Card>
      </div>
      )}
    </div>
  );
};

export default InboxPage;
