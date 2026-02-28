import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import TagManager from "@/components/contacts/TagManager";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  GripVertical,
  Search,
  MoreHorizontal,
  Clock,
  MessageSquare,
  Inbox,
  Timer,
  Flame,
  Eye,
  GitBranchPlus,
  Palette,
  Tag as TagIcon,
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

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface KanbanViewProps {
  conversations: Conversation[];
  onSelectConversation: (id: string) => void;
  onReload: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────────

const DEFAULT_LEGACY_COLUMNS = [
  { id: "open", label: "Abertas", color: "#22c55e" },
  { id: "in_progress", label: "Em Atendimento", color: "#3b82f6" },
  { id: "waiting", label: "Aguardando", color: "#f59e0b" },
  { id: "resolved", label: "Resolvidas", color: "#6b7280" },
];

const PRESET_COLORS = [
  "#22c55e", "#16a34a", "#10b981",
  "#3b82f6", "#2563eb", "#6366f1",
  "#8b5cf6", "#a855f7", "#d946ef",
  "#ec4899", "#f43f5e", "#ef4444",
  "#f97316", "#f59e0b", "#eab308",
  "#14b8a6", "#06b6d4", "#0ea5e9",
  "#6b7280", "#78716c", "#64748b",
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

// ── Color persistence helpers ───────────────────────────────────────

const getLegacyColumnColors = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem("kanban_legacy_colors") || "{}");
  } catch { return {}; }
};

const saveLegacyColumnColor = (colId: string, color: string) => {
  const colors = getLegacyColumnColors();
  colors[colId] = color;
  localStorage.setItem("kanban_legacy_colors", JSON.stringify(colors));
};

// ── Column type ─────────────────────────────────────────────────────

type Column = {
  id: string;
  label: string;
  color: string;
  stageId: string | null;
  notifyAfterHours: number | null;
};

// ── Color Picker ────────────────────────────────────────────────────

const ColorPicker = ({ color, onChange }: { color: string; onChange: (c: string) => void }) => (
  <Popover>
    <PopoverTrigger asChild>
      <button
        className="h-4 w-4 rounded-full ring-2 ring-background shadow-md cursor-pointer hover:scale-125 transition-transform"
        style={{ backgroundColor: color, boxShadow: `0 0 10px ${color}50` }}
      />
    </PopoverTrigger>
    <PopoverContent className="w-auto p-3" align="start" side="bottom">
      <div className="flex items-center gap-2 mb-2">
        <Palette className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Cor da coluna</span>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onChange(c)}
            className={cn(
              "h-6 w-6 rounded-full transition-all hover:scale-110",
              color === c && "ring-2 ring-offset-2 ring-primary"
            )}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </PopoverContent>
  </Popover>
);

// ── Card Component ──────────────────────────────────────────────────

const KanbanCard = ({
  conv,
  col,
  columns,
  draggedId,
  tags,
  onDragStart,
  onDragEnd,
  onSelect,
  onMove,
  onTagsChanged,
}: {
  conv: Conversation;
  col: Column;
  columns: Column[];
  draggedId: string | null;
  tags: Tag[];
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  onSelect: (id: string) => void;
  onMove: (id: string, col: Column) => void;
  onTagsChanged: () => void;
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
        "group relative cursor-pointer rounded-xl border bg-card p-3 transition-all duration-200",
        "hover:shadow-lg hover:-translate-y-0.5 hover:border-primary/30",
        "active:scale-[0.98]",
        urgency === "critical" && "border-l-[3px] border-l-destructive bg-destructive/5",
        urgency === "warning" && "border-l-[3px] border-l-amber-400",
        urgency === "normal" && "border-border/50",
        draggedId === conv.id && "opacity-30 scale-95 rotate-1"
      )}
    >
      {urgency === "critical" && (
        <div className="absolute -inset-px rounded-xl bg-destructive/5 pointer-events-none" />
      )}

      <div className="relative flex items-start gap-2.5">
        <GripVertical className="h-4 w-4 mt-1 text-muted-foreground/20 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 cursor-grab active:cursor-grabbing" />

        <div className="relative shrink-0">
          <Avatar className="h-9 w-9 ring-2 ring-background shadow-sm">
            {conv.contact?.profile_picture && <AvatarImage src={conv.contact.profile_picture} />}
            <AvatarFallback
              className="text-xs font-bold"
              style={{ backgroundColor: `${col.color}18`, color: col.color }}
            >
              {getInitials(conv.contact?.name || null, conv.contact?.phone || "")}
            </AvatarFallback>
          </Avatar>
          {hasUnread && (
            <div className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-primary border-2 border-background animate-pulse" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className="text-sm font-semibold truncate leading-tight">
              {conv.contact?.name || conv.contact?.phone || "Desconhecido"}
            </span>

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
              <DropdownMenuContent align="end" className="w-56" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem className="text-xs gap-2" onClick={() => onSelect(conv.id)}>
                  <Eye className="h-3.5 w-3.5" /> Abrir conversa
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {/* Tag management inline */}
                <div className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase mb-1.5 flex items-center gap-1">
                    <TagIcon className="h-3 w-3" /> Tags
                  </p>
                  <TagManager contactId={conv.contact_id} compact onChanged={onTagsChanged} />
                </div>
                <DropdownMenuSeparator />
                {columns
                  .filter((c) => c.id !== col.id)
                  .map((c) => (
                    <DropdownMenuItem key={c.id} className="text-xs gap-2" onClick={() => onMove(conv.id, c)}>
                      <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                      {c.label}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <p className="text-xs text-muted-foreground truncate mt-1 leading-relaxed">
            {conv.lastMessage?.direction === "outbound" && (
              <span className="text-primary/60">Você: </span>
            )}
            {conv.lastMessage?.content || (conv.lastMessage?.type !== "text" ? `📎 ${conv.lastMessage?.type}` : "Sem mensagens")}
          </p>

          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {tags.map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-semibold ring-1 ring-inset"
                  style={{ backgroundColor: `${tag.color}15`, color: tag.color }}
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-border/40">
            <span className="text-[10px] text-muted-foreground/60 font-medium">
              {conv.last_message_at ? formatTime(conv.last_message_at) : ""}
            </span>
            <div className="flex items-center gap-1.5">
              {urgency !== "normal" && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className={cn(
                        "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                        urgency === "critical" ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-600"
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
  const [selectedFunnelId, setSelectedFunnelId] = useState<string>(() => {
    return localStorage.getItem("kanban_selected_funnel") || "legacy";
  });
  const [contactTagsMap, setContactTagsMap] = useState<Record<string, Tag[]>>({});
  const [legacyColors, setLegacyColors] = useState<Record<string, string>>(getLegacyColumnColors);

  const handleFunnelChange = useCallback((value: string) => {
    setSelectedFunnelId(value);
    localStorage.setItem("kanban_selected_funnel", value);
  }, []);

  const handleLegacyColorChange = useCallback((colId: string, color: string) => {
    saveLegacyColumnColor(colId, color);
    setLegacyColors((prev) => ({ ...prev, [colId]: color }));
  }, []);

  const handleStageColorChange = useCallback(async (stageId: string, color: string) => {
    const { error } = await supabase.from("funnel_stages").update({ color }).eq("id", stageId);
    if (error) { toast.error("Erro ao salvar cor"); return; }
    setStages((prev) => prev.map((s) => (s.id === stageId ? { ...s, color } : s)));
  }, []);

  const loadContactTags = useCallback(async () => {
    const contactIds = [...new Set(conversations.map((c) => c.contact_id))];
    if (contactIds.length === 0) return;
    const { data: ctData } = await supabase.from("contact_tags").select("contact_id, tag_id").in("contact_id", contactIds);
    if (!ctData || ctData.length === 0) { setContactTagsMap({}); return; }
    const tagIds = [...new Set(ctData.map((ct) => ct.tag_id))];
    const { data: tagsData } = await supabase.from("tags").select("*").in("id", tagIds);
    const tagMap = new Map((tagsData || []).map((t) => [t.id, t as Tag]));
    const result: Record<string, Tag[]> = {};
    for (const ct of ctData) {
      const tag = tagMap.get(ct.tag_id);
      if (tag) {
        if (!result[ct.contact_id]) result[ct.contact_id] = [];
        result[ct.contact_id].push(tag);
      }
    }
    setContactTagsMap(result);
  }, [conversations]);

  const loadFunnels = useCallback(async () => {
    const [{ data: f }, { data: s }] = await Promise.all([
      supabase.from("funnels").select("id, name, is_default").order("created_at"),
      supabase.from("funnel_stages").select("*").order("position"),
    ]);
    const funnelList = (f || []) as Funnel[];
    setFunnels(funnelList);
    setStages((s || []) as FunnelStage[]);
    const saved = localStorage.getItem("kanban_selected_funnel");
    if (!saved || saved === "legacy") {
      const defaultFunnel = funnelList.find((fn) => fn.is_default);
      if (defaultFunnel) {
        setSelectedFunnelId(defaultFunnel.id);
        localStorage.setItem("kanban_selected_funnel", defaultFunnel.id);
      }
    }
  }, []);

  useEffect(() => { loadFunnels(); }, [loadFunnels]);
  useEffect(() => { loadContactTags(); }, [loadContactTags]);

  const isLegacy = selectedFunnelId === "legacy";
  const funnelStages = stages.filter((s) => s.funnel_id === selectedFunnelId).sort((a, b) => a.position - b.position);

  const columns: Column[] = isLegacy
    ? DEFAULT_LEGACY_COLUMNS.map((c) => ({
        id: c.id,
        label: c.label,
        color: legacyColors[c.id] || c.color,
        stageId: null,
        notifyAfterHours: null,
      }))
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
        const u = getUrgency(getWaitHours(c.last_message_at), col.notifyAfterHours);
        return urgencyFilter === "critical" ? u === "critical" : u !== "normal";
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
    <div className="flex flex-col h-[calc(100vh-220px)] gap-3">
      {/* ─── Toolbar ─── */}
      <div className="flex items-center gap-3 flex-wrap rounded-2xl border border-border/50 bg-card/80 backdrop-blur-md px-4 py-2.5 shadow-sm">
        <Select value={selectedFunnelId} onValueChange={handleFunnelChange}>
          <SelectTrigger className="h-8 w-[200px] text-sm border-border/40 bg-background/70 rounded-lg">
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

        <div className="h-5 w-px bg-border/40 hidden sm:block" />

        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar contato..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 h-8 text-sm border-border/40 bg-background/70 rounded-lg"
          />
        </div>

        <div className="h-5 w-px bg-border/40 hidden sm:block" />

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
        className="grid flex-1 gap-3 min-h-0 overflow-x-auto"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(${columns.length > 5 ? "230px" : "0"}, 1fr))` }}
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
                  ? "border-primary/60 shadow-xl scale-[1.01]"
                  : "border-border/40"
              )}
              style={{
                background: isDragOver
                  ? `linear-gradient(180deg, ${col.color}12 0%, transparent 40%)`
                  : `linear-gradient(180deg, ${col.color}08 0%, transparent 30%)`,
              }}
              onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.id); }}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={(e) => handleDrop(e, col)}
            >
              {/* ── Column Header ── */}
              <div className="px-4 pt-4 pb-3 space-y-2">
                {/* Top accent bar */}
                <div
                  className="h-1 -mx-4 -mt-4 rounded-t-2xl"
                  style={{ backgroundColor: col.color }}
                />

                <div className="flex items-center gap-2 pt-1">
                  <ColorPicker
                    color={col.color}
                    onChange={(c) =>
                      isLegacy
                        ? handleLegacyColorChange(col.id, c)
                        : col.stageId && handleStageColorChange(col.stageId, c)
                    }
                  />
                  <h3 className="text-sm font-bold tracking-tight truncate">{col.label}</h3>
                  <span
                    className="ml-auto text-[11px] font-bold rounded-lg px-2 py-0.5"
                    style={{ backgroundColor: `${col.color}15`, color: col.color }}
                  >
                    {items.length}
                  </span>
                </div>

                {/* Distribution bar */}
                <div className="h-1 rounded-full bg-border/30 overflow-hidden">
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
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/40">
                      <Inbox className="h-8 w-8 mb-2 opacity-30" />
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
                        tags={contactTagsMap[conv.contact_id] || []}
                        onDragStart={handleDragStart}
                        onDragEnd={() => { setDraggedId(null); setDragOverCol(null); }}
                        onSelect={onSelectConversation}
                        onMove={moveToColumn}
                        onTagsChanged={loadContactTags}
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
