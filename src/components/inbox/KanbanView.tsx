import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
  UserPlus,
  Tag,
  AlertTriangle,
  Clock,
  MessageSquare,
  ArrowRight,
  Star,
  Filter,
} from "lucide-react";
import { useRef, useState, useMemo } from "react";

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
  contact?: Contact;
  lastMessage?: Message;
}

interface KanbanViewProps {
  conversations: Conversation[];
  onSelectConversation: (id: string) => void;
  onReload: () => void;
}

const columns = [
  { id: "open", label: "Abertas", dotColor: "bg-success" },
  { id: "in_progress", label: "Em Atendimento", dotColor: "bg-info" },
  { id: "waiting", label: "Aguardando", dotColor: "bg-warning" },
  { id: "resolved", label: "Resolvidas", dotColor: "bg-muted-foreground" },
];

const statusLabels: Record<string, string> = {
  open: "Aberta",
  in_progress: "Em Atendimento",
  waiting: "Aguardando",
  resolved: "Resolvida",
};

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

/** Returns hours since last message */
const getWaitHours = (lastMessageAt: string | null): number => {
  if (!lastMessageAt) return 0;
  return (Date.now() - new Date(lastMessageAt).getTime()) / 3600000;
};

/** SLA urgency level based on wait time */
const getUrgency = (hours: number): "critical" | "warning" | "normal" => {
  if (hours >= 4) return "critical";
  if (hours >= 2) return "warning";
  return "normal";
};

const urgencyStyles: Record<string, string> = {
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

  // Filtered conversations
  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => {
      // Search filter
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const name = (c.contact?.name || "").toLowerCase();
        const phone = (c.contact?.phone || "").toLowerCase();
        const msg = (c.lastMessage?.content || "").toLowerCase();
        if (!name.includes(term) && !phone.includes(term) && !msg.includes(term)) return false;
      }
      // Urgency filter
      if (urgencyFilter !== "all") {
        const hours = getWaitHours(c.last_message_at);
        const urgency = getUrgency(hours);
        if (urgencyFilter === "critical" && urgency !== "critical") return false;
        if (urgencyFilter === "warning" && urgency !== "critical" && urgency !== "warning") return false;
      }
      return true;
    });
  }, [conversations, searchTerm, urgencyFilter]);

  // Column metrics
  const columnMetrics = useMemo(() => {
    const metrics: Record<string, { count: number; unread: number; avgWait: number; criticalCount: number }> = {};
    columns.forEach((col) => {
      const items = filteredConversations.filter((c) => c.status === col.id);
      const waitHours = items.map((c) => getWaitHours(c.last_message_at));
      const totalUnread = items.reduce((sum, c) => sum + (c.unread_count ?? 0), 0);
      const criticalCount = waitHours.filter((h) => h >= 4).length;
      const avgWait = waitHours.length > 0 ? waitHours.reduce((a, b) => a + b, 0) / waitHours.length : 0;
      metrics[col.id] = { count: items.length, unread: totalUnread, avgWait, criticalCount };
    });
    return metrics;
  }, [filteredConversations]);

  const handleDragStart = (e: React.DragEvent, convId: string) => {
    setDraggedId(convId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", convId);
  };

  const handleDragOver = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCol(colId);
  };

  const handleDragLeave = () => setDragOverCol(null);

  const handleDrop = async (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    setDragOverCol(null);
    const convId = e.dataTransfer.getData("text/plain");
    if (!convId) return;

    const conv = conversations.find((c) => c.id === convId);
    if (!conv || conv.status === newStatus) {
      setDraggedId(null);
      return;
    }

    const { error } = await supabase
      .from("conversations")
      .update({ status: newStatus })
      .eq("id", convId);

    if (error) {
      toast.error("Erro ao mover conversa");
    } else {
      toast.success(`Conversa movida para ${statusLabels[newStatus] || newStatus}`);
      onReload();
    }
    setDraggedId(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverCol(null);
  };

  const moveToStatus = async (convId: string, newStatus: string) => {
    const { error } = await supabase
      .from("conversations")
      .update({ status: newStatus })
      .eq("id", convId);
    if (error) {
      toast.error("Erro ao mover conversa");
    } else {
      toast.success(`Movida para ${statusLabels[newStatus] || newStatus}`);
      onReload();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-220px)] gap-3">
      {/* Search & Filters Bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar no Kanban..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 h-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={urgencyFilter === "all" ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs"
            onClick={() => setUrgencyFilter("all")}
          >
            Todas
          </Button>
          <Button
            variant={urgencyFilter === "warning" ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={() => setUrgencyFilter("warning")}
          >
            <Clock className="h-3 w-3" /> +2h
          </Button>
          <Button
            variant={urgencyFilter === "critical" ? "destructive" : "outline"}
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={() => setUrgencyFilter("critical")}
          >
            <AlertTriangle className="h-3 w-3" /> +4h
          </Button>
        </div>
      </div>

      {/* Kanban Board */}
      <div className="grid flex-1 grid-cols-4 gap-3 min-h-0">
        {columns.map((col) => {
          const items = filteredConversations.filter((c) => c.status === col.id);
          const isDragOver = dragOverCol === col.id;
          const metrics = columnMetrics[col.id];

          return (
            <div
              key={col.id}
              className={cn(
                "flex flex-col rounded-xl border border-border bg-card transition-colors min-h-0",
                isDragOver && "border-primary/50 bg-primary/5"
              )}
              onDragOver={(e) => handleDragOver(e, col.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, col.id)}
            >
              {/* Column Header */}
              <div className="border-b border-border px-4 py-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className={cn("h-2.5 w-2.5 rounded-full", col.dotColor)} />
                  <h3 className="text-sm font-semibold">{col.label}</h3>
                  <Badge variant="secondary" className="ml-auto text-xs h-5 min-w-[20px] flex items-center justify-center rounded-full">
                    {metrics.count}
                  </Badge>
                </div>
                {/* Metrics row */}
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  {metrics.unread > 0 && (
                    <span className="flex items-center gap-0.5">
                      <MessageSquare className="h-3 w-3" />
                      {metrics.unread} não lidas
                    </span>
                  )}
                  {metrics.avgWait > 0 && (
                    <span className="flex items-center gap-0.5">
                      <Clock className="h-3 w-3" />
                      ~{formatWaitTime(metrics.avgWait)}
                    </span>
                  )}
                  {metrics.criticalCount > 0 && (
                    <span className="flex items-center gap-0.5 text-destructive font-medium">
                      <AlertTriangle className="h-3 w-3" />
                      {metrics.criticalCount}
                    </span>
                  )}
                </div>
              </div>

              {/* Column Content */}
              <ScrollArea className="flex-1 p-2">
                <div className="space-y-2">
                  {items.length === 0 ? (
                    <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                      Nenhuma conversa
                    </div>
                  ) : (
                    items.map((conv) => {
                      const waitHours = getWaitHours(conv.last_message_at);
                      const urgency = getUrgency(waitHours);

                      return (
                        <div
                          key={conv.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, conv.id)}
                          onDragEnd={handleDragEnd}
                          onClick={() => onSelectConversation(conv.id)}
                          className={cn(
                            "group cursor-pointer rounded-lg border border-border bg-background p-3 transition-all hover:shadow-md hover:border-primary/30",
                            urgencyStyles[urgency],
                            draggedId === conv.id && "opacity-40 scale-95"
                          )}
                        >
                          <div className="flex items-start gap-2">
                            <GripVertical className="h-4 w-4 mt-0.5 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 cursor-grab" />
                            <Avatar className="h-8 w-8 shrink-0">
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
                                {/* Quick actions menu */}
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                    >
                                      <MoreHorizontal className="h-3.5 w-3.5" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
                                    <DropdownMenuItem className="text-xs" onClick={() => onSelectConversation(conv.id)}>
                                      <MessageSquare className="h-3.5 w-3.5 mr-2" /> Abrir conversa
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    {columns
                                      .filter((c) => c.id !== conv.status)
                                      .map((c) => (
                                        <DropdownMenuItem
                                          key={c.id}
                                          className="text-xs"
                                          onClick={() => moveToStatus(conv.id, c.id)}
                                        >
                                          <ArrowRight className="h-3.5 w-3.5 mr-2" />
                                          Mover para {c.label}
                                        </DropdownMenuItem>
                                      ))}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                              <p className="text-xs text-muted-foreground truncate mt-0.5">
                                {conv.lastMessage?.content || (conv.lastMessage?.type !== "text" ? `📎 ${conv.lastMessage?.type}` : "Sem mensagens")}
                              </p>
                              <div className="flex items-center justify-between mt-1.5">
                                <p className="text-[10px] text-muted-foreground/60">
                                  {conv.last_message_at ? formatTime(conv.last_message_at) : ""}
                                </p>
                                <div className="flex items-center gap-1.5">
                                  {/* SLA indicator */}
                                  {urgency !== "normal" && (
                                    <span className={cn(
                                      "text-[10px] font-medium flex items-center gap-0.5",
                                      urgency === "critical" ? "text-destructive" : "text-warning"
                                    )}>
                                      <Clock className="h-3 w-3" />
                                      {formatWaitTime(waitHours)}
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
