import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  GripVertical,
  Search,
  MoreHorizontal,
  AlertTriangle,
  Clock,
  MessageSquare,
  ArrowRight,
  GitBranchPlus,
} from "lucide-react";
import { useState, useMemo, useEffect, useCallback } from "react";

interface Contact {
  id: string;
  name: string | null;
  phone: string;
  profile_picture: string | null;
  about: string | null;
  is_blocked: boolean | null;
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

interface Conversation {
  id: string;
  contact_id: string;
  status: string;
  unread_count: number | null;
  last_message_at: string | null;
  notes: string | null;
  funnel_id?: string | null;
  funnel_stage_id?: string | null;
  contact?: Contact;
  lastMessage?: Message;
}

interface FunnelStage {
  id: string;
  funnel_id: string;
  name: string;
  color: string;
  position: number;
  auto_move_on_reply: boolean;
  notify_after_hours: number | null;
}

interface Funnel {
  id: string;
  name: string;
  is_default: boolean;
}

interface KanbanViewProps {
  conversations: Conversation[];
  onSelectConversation: (id: string) => void;
  onReload: () => void;
}

// Legacy columns fallback
const legacyColumns = [
  { id: "open", label: "Abertas", color: "#22c55e" },
  { id: "in_progress", label: "Em Atendimento", color: "#3b82f6" },
  { id: "waiting", label: "Aguardando", color: "#f59e0b" },
  { id: "resolved", label: "Resolvidas", color: "#6b7280" },
];

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

const getWaitHours = (lastMessageAt: string | null): number => {
  if (!lastMessageAt) return 0;
  return (Date.now() - new Date(lastMessageAt).getTime()) / 3600000;
};

const getUrgency = (hours: number, notifyAfterHours?: number | null): "critical" | "warning" | "normal" => {
  const threshold = notifyAfterHours ?? 4;
  if (hours >= threshold) return "critical";
  if (hours >= threshold * 0.5) return "warning";
  return "normal";
};

const urgencyBorder: Record<string, string> = {
  critical: "border-l-4 border-l-destructive",
  warning: "border-l-4 border-l-warning",
  normal: "",
};

const formatWaitTime = (hours: number): string => {
  if (hours < 1) return `${Math.round(hours * 60)}min`;
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
};

const KanbanView = ({ conversations, onSelectConversation, onReload }: KanbanViewProps) => {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [urgencyFilter, setUrgencyFilter] = useState<"all" | "warning" | "critical">("all");
  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [stages, setStages] = useState<FunnelStage[]>([]);
  const [selectedFunnelId, setSelectedFunnelId] = useState<string>("legacy");

  // Load funnels & stages
  const loadFunnels = useCallback(async () => {
    const [{ data: f }, { data: s }] = await Promise.all([
      supabase.from("funnels").select("id, name, is_default").order("created_at"),
      supabase.from("funnel_stages").select("*").order("position"),
    ]);
    const funnelList = (f || []) as Funnel[];
    setFunnels(funnelList);
    setStages((s || []) as FunnelStage[]);
    // Auto-select default funnel
    const defaultFunnel = funnelList.find((fn) => fn.is_default);
    if (defaultFunnel && selectedFunnelId === "legacy") {
      setSelectedFunnelId(defaultFunnel.id);
    }
  }, []);

  useEffect(() => {
    loadFunnels();
  }, [loadFunnels]);

  const isLegacy = selectedFunnelId === "legacy";
  const funnelStages = stages.filter((s) => s.funnel_id === selectedFunnelId).sort((a, b) => a.position - b.position);

  // Columns to render
  const columns = isLegacy
    ? legacyColumns.map((c) => ({ id: c.id, label: c.label, color: c.color, stageId: null, notifyAfterHours: null as number | null }))
    : funnelStages.map((s) => ({ id: s.id, label: s.name, color: s.color, stageId: s.id, notifyAfterHours: s.notify_after_hours }));

  // Get conversations for a column
  const getColumnItems = (col: typeof columns[0]) => {
    if (isLegacy) {
      return conversations.filter((c) => c.status === col.id);
    }
    return conversations.filter((c) => c.funnel_stage_id === col.stageId);
  };

  // Filtered conversations
  const filteredForColumn = (col: typeof columns[0]) => {
    let items = getColumnItems(col);
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      items = items.filter((c) => {
        const name = (c.contact?.name || "").toLowerCase();
        const phone = (c.contact?.phone || "").toLowerCase();
        return name.includes(term) || phone.includes(term);
      });
    }
    if (urgencyFilter !== "all") {
      items = items.filter((c) => {
        const hours = getWaitHours(c.last_message_at);
        const urgency = getUrgency(hours, col.notifyAfterHours);
        if (urgencyFilter === "critical") return urgency === "critical";
        return urgency !== "normal";
      });
    }
    return items;
  };

  const handleDragStart = (e: React.DragEvent, convId: string) => {
    setDraggedId(convId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", convId);
  };

  const handleDrop = async (e: React.DragEvent, col: typeof columns[0]) => {
    e.preventDefault();
    setDragOverCol(null);
    const convId = e.dataTransfer.getData("text/plain");
    if (!convId) return;

    const conv = conversations.find((c) => c.id === convId);
    if (!conv) { setDraggedId(null); return; }

    if (isLegacy) {
      if (conv.status === col.id) { setDraggedId(null); return; }
      const { error } = await supabase.from("conversations").update({ status: col.id }).eq("id", convId);
      if (error) toast.error("Erro ao mover");
      else { toast.success(`Movida para ${col.label}`); onReload(); }
    } else {
      if (conv.funnel_stage_id === col.stageId) { setDraggedId(null); return; }
      const { error } = await supabase
        .from("conversations")
        .update({ funnel_id: selectedFunnelId, funnel_stage_id: col.stageId })
        .eq("id", convId);
      if (error) toast.error("Erro ao mover");
      else { toast.success(`Movida para ${col.label}`); onReload(); }
    }
    setDraggedId(null);
  };

  const moveToColumn = async (convId: string, col: typeof columns[0]) => {
    if (isLegacy) {
      await supabase.from("conversations").update({ status: col.id }).eq("id", convId);
    } else {
      await supabase.from("conversations").update({ funnel_id: selectedFunnelId, funnel_stage_id: col.stageId }).eq("id", convId);
    }
    toast.success(`Movida para ${col.label}`);
    onReload();
  };

  const gridCols = columns.length <= 3 ? "grid-cols-3" : columns.length === 4 ? "grid-cols-4" : columns.length === 5 ? "grid-cols-5" : "grid-cols-6";

  return (
    <div className="flex flex-col h-[calc(100vh-220px)] gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Funnel selector */}
        <Select value={selectedFunnelId} onValueChange={setSelectedFunnelId}>
          <SelectTrigger className="h-8 w-[200px] text-sm">
            <GitBranchPlus className="h-3.5 w-3.5 mr-1.5" />
            <SelectValue placeholder="Selecionar funil" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="legacy">Padrão (Status)</SelectItem>
            {funnels.map((f) => (
              <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 h-8 text-sm" />
        </div>

        <div className="flex items-center gap-1">
          <Button variant={urgencyFilter === "all" ? "default" : "outline"} size="sm" className="h-8 text-xs" onClick={() => setUrgencyFilter("all")}>
            Todas
          </Button>
          <Button variant={urgencyFilter === "warning" ? "default" : "outline"} size="sm" className="h-8 text-xs gap-1" onClick={() => setUrgencyFilter("warning")}>
            <Clock className="h-3 w-3" /> Atrasadas
          </Button>
          <Button variant={urgencyFilter === "critical" ? "destructive" : "outline"} size="sm" className="h-8 text-xs gap-1" onClick={() => setUrgencyFilter("critical")}>
            <AlertTriangle className="h-3 w-3" /> Críticas
          </Button>
        </div>
      </div>

      {/* Board */}
      <div className={cn("grid flex-1 gap-3 min-h-0", gridCols)} style={columns.length > 6 ? { gridTemplateColumns: `repeat(${columns.length}, minmax(220px, 1fr))`, overflowX: "auto" } : undefined}>
        {columns.map((col) => {
          const items = filteredForColumn(col);
          const isDragOver = dragOverCol === col.id;
          const totalUnread = items.reduce((sum, c) => sum + (c.unread_count ?? 0), 0);

          return (
            <div
              key={col.id}
              className={cn(
                "flex flex-col rounded-xl border border-border bg-card transition-colors min-h-0",
                isDragOver && "border-primary/50 bg-primary/5"
              )}
              onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.id); }}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={(e) => handleDrop(e, col)}
            >
              {/* Header */}
              <div className="border-b border-border px-4 py-3 space-y-1">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
                  <h3 className="text-sm font-semibold truncate">{col.label}</h3>
                  <Badge variant="secondary" className="ml-auto text-xs h-5 min-w-[20px] flex items-center justify-center rounded-full">
                    {items.length}
                  </Badge>
                </div>
                {totalUnread > 0 && (
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <MessageSquare className="h-3 w-3" /> {totalUnread} não lidas
                  </div>
                )}
              </div>

              {/* Cards */}
              <ScrollArea className="flex-1 p-2">
                <div className="space-y-2">
                  {items.length === 0 ? (
                    <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                      Nenhuma conversa
                    </div>
                  ) : (
                    items.map((conv) => {
                      const waitHours = getWaitHours(conv.last_message_at);
                      const urgency = getUrgency(waitHours, col.notifyAfterHours);

                      return (
                        <div
                          key={conv.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, conv.id)}
                          onDragEnd={() => { setDraggedId(null); setDragOverCol(null); }}
                          onClick={() => onSelectConversation(conv.id)}
                          className={cn(
                            "group cursor-pointer rounded-lg border border-border bg-background p-3 transition-all hover:shadow-md hover:border-primary/30",
                            urgencyBorder[urgency],
                            draggedId === conv.id && "opacity-40 scale-95"
                          )}
                        >
                          <div className="flex items-start gap-2">
                            <GripVertical className="h-4 w-4 mt-0.5 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 cursor-grab" />
                            <Avatar className="h-8 w-8 shrink-0">
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
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                    <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                      <MoreHorizontal className="h-3.5 w-3.5" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
                                    <DropdownMenuItem className="text-xs" onClick={() => onSelectConversation(conv.id)}>
                                      <MessageSquare className="h-3.5 w-3.5 mr-2" /> Abrir conversa
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    {columns
                                      .filter((c) => c.id !== col.id)
                                      .map((c) => (
                                        <DropdownMenuItem key={c.id} className="text-xs" onClick={() => moveToColumn(conv.id, c)}>
                                          <ArrowRight className="h-3.5 w-3.5 mr-2" /> Mover para {c.label}
                                        </DropdownMenuItem>
                                      ))}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                              <p className="text-xs text-muted-foreground truncate mt-0.5">
                                {conv.lastMessage?.content || "Sem mensagens"}
                              </p>
                              <div className="flex items-center justify-between mt-1.5">
                                <p className="text-[10px] text-muted-foreground/60">
                                  {conv.last_message_at ? formatTime(conv.last_message_at) : ""}
                                </p>
                                <div className="flex items-center gap-1.5">
                                  {urgency !== "normal" && (
                                    <span className={cn("text-[10px] font-medium flex items-center gap-0.5", urgency === "critical" ? "text-destructive" : "text-warning")}>
                                      <Clock className="h-3 w-3" /> {formatWaitTime(waitHours)}
                                    </span>
                                  )}
                                  {(conv.unread_count ?? 0) > 0 && (
                                    <Badge className="h-4 min-w-[16px] shrink-0 rounded-full p-0 text-[10px] flex items-center justify-center">
                                      {conv.unread_count}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default KanbanView;
