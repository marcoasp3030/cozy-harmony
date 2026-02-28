import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  Inbox,
  Timer,
  Flame,
  Eye,
} from "lucide-react";
import { useState, useMemo, useEffect, useCallback } from "react";

// ── Interfaces ──────────────────────────────────────────────────────

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

// ── Helpers ─────────────────────────────────────────────────────────

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
  if (diff < 86400000 && d.getDate() === now.getDate())
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
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

const getUrgency = (hours: number, threshold?: number | null): "critical" | "warning" | "normal" => {
  const t = threshold ?? 4;
  if (hours >= t) return "critical";
  if (hours >= t * 0.5) return "warning";
  return "normal";
};

const formatWaitTime = (hours: number): string => {
  if (hours < 1) return `${Math.round(hours * 60)}min`;
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
};

// ── Column type ─────────────────────────────────────────────────────

type Column = {
  id: string;
  label: string;
  color: string;
  stageId: string | null;
  notifyAfterHours: number | null;
};

// ── Card Component ──────────────────────────────────────────────────

const KanbanCard = ({
  conv,
  col,
  columns,
  draggedId,
  onDragStart,
  onDragEnd,
  onSelect,
  onMove,
}: {
  conv: Conversation;
  col: Column;
  columns: Column[];
  draggedId: string | null;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  onSelect: (id: string) => void;
  onMove: (id: string, col: Column) => void;
}) => {
  const waitHours = getWaitHours(conv.last_message_at);
  const urgency = getUrgency(waitHours, col.notifyAfterHours);
  const hasUnread = (conv.unread_count ?? 0) > 0;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, conv.id)}
      onDragEnd={onDragEnd}
      onClick={() => onSelect(conv.id)}
      className={cn(
        "group relative cursor-pointer rounded-xl border bg-background p-3 transition-all duration-200",
        "hover:shadow-lg hover:-translate-y-0.5 hover:border-primary/40",
        "active:scale-[0.98]",
        urgency === "critical" && "border-l-[3px] border-l-destructive",
        urgency === "warning" && "border-l-[3px] border-l-warning",
        urgency === "normal" && "border-border",
        draggedId === conv.id && "opacity-30 scale-95 rotate-1"
      )}
    >
      {/* Urgency glow */}
      {urgency === "critical" && (
        <div className="absolute -inset-px rounded-xl bg-destructive/5 pointer-events-none" />
      )}

      <div className="relative flex items-start gap-2.5">
        {/* Drag handle */}
        <GripVertical className="h-4 w-4 mt-1 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 cursor-grab active:cursor-grabbing" />

        {/* Avatar with online dot */}
        <div className="relative shrink-0">
          <Avatar className="h-9 w-9 ring-2 ring-background">
            {conv.contact?.profile_picture && <AvatarImage src={conv.contact.profile_picture} />}
            <AvatarFallback
              className="text-xs font-semibold"
              style={{ backgroundColor: `${col.color}15`, color: col.color }}
            >
              {getInitials(conv.contact?.name || null, conv.contact?.phone || "")}
            </AvatarFallback>
          </Avatar>
          {hasUnread && (
            <div className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-primary border-2 border-background" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className="text-sm font-semibold truncate leading-tight">
              {conv.contact?.name || conv.contact?.phone || "Desconhecido"}
            </span>

            {/* Quick actions */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-md opacity-0 group-hover:opacity-100 transition-all shrink-0"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem className="text-xs gap-2" onClick={() => onSelect(conv.id)}>
                  <Eye className="h-3.5 w-3.5" /> Abrir conversa
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {columns
                  .filter((c) => c.id !== col.id)
                  .map((c) => (
                    <DropdownMenuItem key={c.id} className="text-xs gap-2" onClick={() => onMove(conv.id, c)}>
                      <div className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />
                      {c.label}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Last message */}
          <p className="text-xs text-muted-foreground truncate mt-1 leading-relaxed">
            {conv.lastMessage?.direction === "outbound" && (
              <span className="text-primary/60">Você: </span>
            )}
            {conv.lastMessage?.content || (conv.lastMessage?.type !== "text" ? `📎 ${conv.lastMessage?.type}` : "Sem mensagens")}
          </p>

          {/* Footer row */}
          <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-border/50">
            <span className="text-[10px] text-muted-foreground/70 font-medium">
              {conv.last_message_at ? formatTime(conv.last_message_at) : ""}
            </span>

            <div className="flex items-center gap-1.5">
              {/* SLA badge */}
              {urgency !== "normal" && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className={cn(
                        "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                        urgency === "critical"
                          ? "bg-destructive/10 text-destructive"
                          : "bg-warning/10 text-warning"
                      )}
                    >
                      {urgency === "critical" ? <Flame className="h-3 w-3" /> : <Timer className="h-3 w-3" />}
                      {formatWaitTime(waitHours)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    Aguardando há {formatWaitTime(waitHours)}
                  </TooltipContent>
                </Tooltip>
              )}

              {/* Unread count */}
              {hasUnread && (
                <span className="inline-flex items-center justify-center h-5 min-w-[20px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-1.5">
                  {conv.unread_count}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Main Kanban ─────────────────────────────────────────────────────

const KanbanView = ({ conversations, onSelectConversation, onReload }: KanbanViewProps) => {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [urgencyFilter, setUrgencyFilter] = useState<"all" | "warning" | "critical">("all");
  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [stages, setStages] = useState<FunnelStage[]>([]);
  const [selectedFunnelId, setSelectedFunnelId] = useState<string>("legacy");

  const loadFunnels = useCallback(async () => {
    const [{ data: f }, { data: s }] = await Promise.all([
      supabase.from("funnels").select("id, name, is_default").order("created_at"),
      supabase.from("funnel_stages").select("*").order("position"),
    ]);
    const funnelList = (f || []) as Funnel[];
    setFunnels(funnelList);
    setStages((s || []) as FunnelStage[]);
    const defaultFunnel = funnelList.find((fn) => fn.is_default);
    if (defaultFunnel && selectedFunnelId === "legacy") {
      setSelectedFunnelId(defaultFunnel.id);
    }
  }, []);

  useEffect(() => { loadFunnels(); }, [loadFunnels]);

  const isLegacy = selectedFunnelId === "legacy";
  const funnelStages = stages.filter((s) => s.funnel_id === selectedFunnelId).sort((a, b) => a.position - b.position);

  const columns: Column[] = isLegacy
    ? legacyColumns.map((c) => ({ id: c.id, label: c.label, color: c.color, stageId: null, notifyAfterHours: null }))
    : funnelStages.map((s) => ({ id: s.id, label: s.name, color: s.color, stageId: s.id, notifyAfterHours: s.notify_after_hours }));

  const getColumnItems = (col: Column) => {
    if (isLegacy) return conversations.filter((c) => c.status === col.id);
    return conversations.filter((c) => c.funnel_stage_id === col.stageId);
  };

  const filteredForColumn = (col: Column) => {
    let items = getColumnItems(col);
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      items = items.filter((c) => (c.contact?.name || "").toLowerCase().includes(term) || (c.contact?.phone || "").toLowerCase().includes(term));
    }
    if (urgencyFilter !== "all") {
      items = items.filter((c) => {
        const urgency = getUrgency(getWaitHours(c.last_message_at), col.notifyAfterHours);
        return urgencyFilter === "critical" ? urgency === "critical" : urgency !== "normal";
      });
    }
    return items;
  };

  const totalConversations = useMemo(() => conversations.length, [conversations]);

  const handleDragStart = (e: React.DragEvent, convId: string) => {
    setDraggedId(convId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", convId);
  };

  const handleDrop = async (e: React.DragEvent, col: Column) => {
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
      const { error } = await supabase.from("conversations").update({ funnel_id: selectedFunnelId, funnel_stage_id: col.stageId }).eq("id", convId);
      if (error) toast.error("Erro ao mover");
      else { toast.success(`Movida para ${col.label}`); onReload(); }
    }
    setDraggedId(null);
  };

  const moveToColumn = async (convId: string, col: Column) => {
    if (isLegacy) {
      await supabase.from("conversations").update({ status: col.id }).eq("id", convId);
    } else {
      await supabase.from("conversations").update({ funnel_id: selectedFunnelId, funnel_stage_id: col.stageId }).eq("id", convId);
    }
    toast.success(`Movida para ${col.label}`);
    onReload();
  };

  return (
    <div className="flex flex-col h-[calc(100vh-220px)] gap-4">
      {/* ─── Toolbar ─── */}
      <div className="flex items-center gap-3 flex-wrap rounded-xl border border-border bg-card/50 backdrop-blur-sm px-4 py-2.5">
        <Select value={selectedFunnelId} onValueChange={setSelectedFunnelId}>
          <SelectTrigger className="h-8 w-[200px] text-sm border-border/50 bg-background/60">
            <GitBranchPlus className="h-3.5 w-3.5 mr-1.5 text-primary" />
            <SelectValue placeholder="Selecionar funil" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="legacy">Padrão (Status)</SelectItem>
            {funnels.map((f) => (
              <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="h-5 w-px bg-border/60 hidden sm:block" />

        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar contato..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 h-8 text-sm border-border/50 bg-background/60"
          />
        </div>

        <div className="h-5 w-px bg-border/60 hidden sm:block" />

        <div className="flex items-center gap-1">
          {(["all", "warning", "critical"] as const).map((filter) => (
            <Button
              key={filter}
              variant={urgencyFilter === filter ? (filter === "critical" ? "destructive" : "default") : "ghost"}
              size="sm"
              className={cn("h-7 text-[11px] px-2.5 rounded-lg", urgencyFilter !== filter && "text-muted-foreground")}
              onClick={() => setUrgencyFilter(filter)}
            >
              {filter === "all" && "Todas"}
              {filter === "warning" && <><Timer className="h-3 w-3 mr-1" /> Atrasadas</>}
              {filter === "critical" && <><Flame className="h-3 w-3 mr-1" /> Críticas</>}
            </Button>
          ))}
        </div>
      </div>

      {/* ─── Board ─── */}
      <div
        className="grid flex-1 gap-3 min-h-0"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(${columns.length > 5 ? "220px" : "0"}, 1fr))` }}
      >
        {columns.map((col) => {
          const items = filteredForColumn(col);
          const isDragOver = dragOverCol === col.id;
          const totalUnread = items.reduce((sum, c) => sum + (c.unread_count ?? 0), 0);
          const proportion = totalConversations > 0 ? (items.length / totalConversations) * 100 : 0;

          return (
            <div
              key={col.id}
              className={cn(
                "flex flex-col rounded-2xl border transition-all duration-300 min-h-0 overflow-hidden",
                isDragOver
                  ? "border-primary shadow-lg shadow-primary/10 scale-[1.01]"
                  : "border-border/60 bg-muted/30"
              )}
              onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.id); }}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={(e) => handleDrop(e, col)}
            >
              {/* ── Column Header ── */}
              <div className="px-4 pt-4 pb-3 space-y-2.5">
                <div className="flex items-center gap-2.5">
                  <div
                    className="h-3 w-3 rounded-md shadow-sm"
                    style={{ backgroundColor: col.color, boxShadow: `0 0 8px ${col.color}40` }}
                  />
                  <h3 className="text-sm font-bold tracking-tight truncate">{col.label}</h3>
                  <span className="ml-auto text-xs font-bold text-muted-foreground bg-background/80 rounded-md px-2 py-0.5">
                    {items.length}
                  </span>
                </div>

                {/* Distribution bar */}
                <div className="h-1 rounded-full bg-border/40 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${proportion}%`, backgroundColor: col.color }}
                  />
                </div>

                {/* Metrics */}
                {(totalUnread > 0 || items.some((c) => getUrgency(getWaitHours(c.last_message_at), col.notifyAfterHours) !== "normal")) && (
                  <div className="flex items-center gap-3 text-[10px]">
                    {totalUnread > 0 && (
                      <span className="flex items-center gap-1 text-primary font-medium">
                        <MessageSquare className="h-3 w-3" /> {totalUnread}
                      </span>
                    )}
                    {items.filter((c) => getUrgency(getWaitHours(c.last_message_at), col.notifyAfterHours) === "critical").length > 0 && (
                      <span className="flex items-center gap-1 text-destructive font-medium">
                        <Flame className="h-3 w-3" />
                        {items.filter((c) => getUrgency(getWaitHours(c.last_message_at), col.notifyAfterHours) === "critical").length}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* ── Cards ── */}
              <ScrollArea className="flex-1 px-2 pb-2">
                <div className="space-y-2">
                  {items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/50">
                      <Inbox className="h-8 w-8 mb-2 opacity-40" />
                      <p className="text-xs font-medium">Nenhuma conversa</p>
                    </div>
                  ) : (
                    items.map((conv) => (
                      <KanbanCard
                        key={conv.id}
                        conv={conv}
                        col={col}
                        columns={columns}
                        draggedId={draggedId}
                        onDragStart={handleDragStart}
                        onDragEnd={() => { setDraggedId(null); setDragOverCol(null); }}
                        onSelect={onSelectConversation}
                        onMove={moveToColumn}
                      />
                    ))
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
