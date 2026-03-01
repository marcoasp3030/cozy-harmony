import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ListOrdered,
  Clock,
  AlertTriangle,
  ArrowUp,
  ArrowRight,
  ArrowDown,
  Flame,
  UserPlus,
  RefreshCw,
  Search,
  Filter,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

// ── Types ────────────────────────────────────────────────────────────

interface QueueItem {
  id: string;
  contact_id: string;
  status: string;
  priority: string;
  sla_hours: number | null;
  last_message_at: string | null;
  score: number;
  assigned_to: string | null;
  created_at: string;
  contact?: {
    name: string | null;
    phone: string;
    profile_picture: string | null;
  };
  // computed
  queueScore: number;
  slaPercent: number;
  waitMinutes: number;
}

interface Attendant {
  id: string;
  user_id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  activeCount: number;
}

// ── Priority config ──────────────────────────────────────────────────

const PRIORITY_WEIGHT: Record<string, number> = {
  urgent: 40,
  high: 25,
  normal: 10,
  low: 0,
};

const PRIORITY_CONFIG: Record<string, { label: string; icon: typeof ArrowUp; color: string }> = {
  urgent: { label: "Urgente", icon: AlertTriangle, color: "hsl(0, 84%, 60%)" },
  high: { label: "Alta", icon: ArrowUp, color: "hsl(25, 95%, 53%)" },
  normal: { label: "Normal", icon: ArrowRight, color: "hsl(220, 9%, 46%)" },
  low: { label: "Baixa", icon: ArrowDown, color: "hsl(217, 91%, 60%)" },
};

// ── Score computation ────────────────────────────────────────────────

function computeQueueScore(conv: {
  priority: string;
  sla_hours: number | null;
  last_message_at: string | null;
  score: number;
}): { queueScore: number; slaPercent: number; waitMinutes: number } {
  const now = Date.now();
  const lastMsg = conv.last_message_at ? new Date(conv.last_message_at).getTime() : now;
  const waitMinutes = Math.max(0, Math.round((now - lastMsg) / 60000));

  // SLA percent
  let slaPercent = 0;
  let slaWeight = 0;
  if (conv.sla_hours && conv.sla_hours > 0) {
    const elapsedHours = waitMinutes / 60;
    slaPercent = Math.min((elapsedHours / conv.sla_hours) * 100, 150);
    // SLA weight: 0-30 points, exponential near deadline
    slaWeight = Math.min(30, (slaPercent / 100) * 30);
    if (slaPercent >= 100) slaWeight = 30; // max
  }

  // Wait time weight: 0-20 points (caps at 8h)
  const waitWeight = Math.min(20, (waitMinutes / 480) * 20);

  // Priority weight: 0-40
  const prioWeight = PRIORITY_WEIGHT[conv.priority] || 10;

  // Lead score weight: 0-10 (normalized assuming max score ~100)
  const scoreWeight = Math.min(10, (conv.score / 100) * 10);

  const queueScore = Math.round(slaWeight + waitWeight + prioWeight + scoreWeight);

  return { queueScore, slaPercent, waitMinutes };
}

// ── Helpers ──────────────────────────────────────────────────────────

const formatWait = (minutes: number) => {
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
};

const getInitials = (name: string | null, phone: string) => {
  if (name) return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  return phone.slice(-2);
};

// ── Queue Page ───────────────────────────────────────────────────────

const QueuePage = () => {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [attendants, setAttendants] = useState<Attendant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterPriority, setFilterPriority] = useState("all");
  const [assignDialog, setAssignDialog] = useState<QueueItem | null>(null);
  const [selectedAttendant, setSelectedAttendant] = useState("");
  const [assigning, setAssigning] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    // Fetch open/pending conversations
    const { data: convs } = await supabase
      .from("conversations")
      .select("id, contact_id, status, priority, sla_hours, last_message_at, score, assigned_to, created_at")
      .in("status", ["open", "pending"])
      .order("last_message_at", { ascending: true });

    if (!convs || convs.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }

    // Fetch contacts
    const contactIds = [...new Set(convs.map((c) => c.contact_id))];
    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, name, phone, profile_picture")
      .in("id", contactIds);

    const contactMap = new Map((contacts || []).map((c: any) => [c.id, c]));

    // Compute queue scores
    const enriched: QueueItem[] = convs.map((c: any) => {
      const { queueScore, slaPercent, waitMinutes } = computeQueueScore(c);
      return {
        ...c,
        priority: c.priority || "normal",
        contact: contactMap.get(c.contact_id),
        queueScore,
        slaPercent,
        waitMinutes,
      };
    });

    // Sort by queueScore descending (highest priority first)
    enriched.sort((a, b) => b.queueScore - a.queueScore);
    setItems(enriched);

    // Fetch attendants (profiles)
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, user_id, name, email, avatar_url");

    // Count active conversations per attendant
    const assignedCounts = new Map<string, number>();
    for (const c of convs) {
      if (c.assigned_to) {
        assignedCounts.set(c.assigned_to, (assignedCounts.get(c.assigned_to) || 0) + 1);
      }
    }

    const atts: Attendant[] = (profiles || []).map((p: any) => ({
      ...p,
      activeCount: assignedCounts.get(p.user_id) || 0,
    }));

    // Sort by least active conversations (suggestion)
    atts.sort((a, b) => a.activeCount - b.activeCount);
    setAttendants(atts);

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Filtered items
  const filtered = useMemo(() => {
    return items.filter((item) => {
      const matchSearch =
        !search ||
        (item.contact?.name || "").toLowerCase().includes(search.toLowerCase()) ||
        (item.contact?.phone || "").includes(search);
      const matchPriority = filterPriority === "all" || item.priority === filterPriority;
      return matchSearch && matchPriority;
    });
  }, [items, search, filterPriority]);

  const unassigned = filtered.filter((i) => !i.assigned_to);
  const assigned = filtered.filter((i) => i.assigned_to);

  const handleAssign = async () => {
    if (!assignDialog || !selectedAttendant) return;
    setAssigning(true);

    const att = attendants.find((a) => a.user_id === selectedAttendant);
    const { error } = await supabase
      .from("conversations")
      .update({ assigned_to: selectedAttendant })
      .eq("id", assignDialog.id);

    if (error) {
      toast.error("Erro ao atribuir conversa");
    } else {
      toast.success(`Conversa atribuída a ${att?.name || "atendente"}`);
      setAssignDialog(null);
      setSelectedAttendant("");
      load();
    }
    setAssigning(false);
  };

  const getScoreColor = (score: number) => {
    if (score >= 60) return "text-destructive";
    if (score >= 35) return "text-amber-500";
    return "text-muted-foreground";
  };

  const getScoreBg = (score: number) => {
    if (score >= 60) return "bg-destructive/10 border-destructive/30";
    if (score >= 35) return "bg-amber-500/10 border-amber-500/30";
    return "bg-muted/50 border-border";
  };

  const QueueRow = ({ item, position }: { item: QueueItem; position: number }) => {
    const prio = PRIORITY_CONFIG[item.priority] || PRIORITY_CONFIG.normal;
    const PrioIcon = prio.icon;

    return (
      <div
        className={cn(
          "flex items-center gap-4 px-4 py-3 rounded-xl border transition-all hover:shadow-md cursor-pointer",
          getScoreBg(item.queueScore)
        )}
      >
        {/* Position */}
        <div className="flex flex-col items-center shrink-0 w-8">
          <span className={cn("text-lg font-bold font-heading", getScoreColor(item.queueScore))}>
            #{position}
          </span>
        </div>

        {/* Avatar */}
        <Avatar className="h-10 w-10 shrink-0">
          {item.contact?.profile_picture && <AvatarImage src={item.contact.profile_picture} />}
          <AvatarFallback className="text-xs font-bold bg-muted">
            {getInitials(item.contact?.name || null, item.contact?.phone || "")}
          </AvatarFallback>
        </Avatar>

        {/* Info */}
        <div className="flex-1 min-w-0" onClick={() => navigate("/inbox")}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold truncate">
              {item.contact?.name || item.contact?.phone || "Desconhecido"}
            </span>
            <Tooltip>
              <TooltipTrigger>
                <PrioIcon className="h-3.5 w-3.5 shrink-0" style={{ color: prio.color }} />
              </TooltipTrigger>
              <TooltipContent className="text-xs">{prio.label}</TooltipContent>
            </Tooltip>
            {item.score > 0 && (
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                Score: {item.score}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> {formatWait(item.waitMinutes)}
            </span>
            {item.sla_hours && (
              <div className="flex items-center gap-1.5">
                <Progress
                  value={Math.min(item.slaPercent, 100)}
                  className="w-16 h-1.5"
                />
                <span
                  className={cn(
                    "text-[10px] font-medium",
                    item.slaPercent >= 100 ? "text-destructive" : item.slaPercent >= 75 ? "text-amber-500" : "text-muted-foreground"
                  )}
                >
                  SLA {Math.round(item.slaPercent)}%
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Queue Score */}
        <Tooltip>
          <TooltipTrigger>
            <div className={cn("text-center shrink-0", getScoreColor(item.queueScore))}>
              <p className="text-xl font-bold font-heading">{item.queueScore}</p>
              <p className="text-[9px]">pts</p>
            </div>
          </TooltipTrigger>
          <TooltipContent className="text-xs max-w-[200px]">
            Pontuação calculada: Prioridade + SLA + Tempo de Espera + Score do Lead
          </TooltipContent>
        </Tooltip>

        {/* Assign button */}
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            setAssignDialog(item);
            // Pre-select suggested attendant (least busy)
            if (attendants.length > 0) {
              setSelectedAttendant(attendants[0].user_id);
            }
          }}
        >
          <UserPlus className="h-3.5 w-3.5" />
          {item.assigned_to ? "Reatribuir" : "Atribuir"}
        </Button>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl md:text-2xl font-bold flex items-center gap-2">
            <ListOrdered className="h-6 w-6 text-primary" />
            Fila de Atendimento
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground">
            Conversas priorizadas automaticamente por SLA, urgência, tempo de espera e score do lead
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Atualizar
        </Button>
      </div>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <ListOrdered className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold font-heading">{items.length}</p>
              <p className="text-[11px] text-muted-foreground">Na fila</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-destructive/10 flex items-center justify-center">
              <Flame className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="text-2xl font-bold font-heading">
                {items.filter((i) => i.slaPercent >= 100).length}
              </p>
              <p className="text-[11px] text-muted-foreground">SLA estourado</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold font-heading">{unassigned.length}</p>
              <p className="text-[11px] text-muted-foreground">Sem atendente</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
              <Clock className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-2xl font-bold font-heading">
                {items.length > 0 ? formatWait(Math.round(items.reduce((a, b) => a + b.waitMinutes, 0) / items.length)) : "—"}
              </p>
              <p className="text-[11px] text-muted-foreground">Espera média</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou telefone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterPriority} onValueChange={setFilterPriority}>
          <SelectTrigger className="w-[180px]">
            <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
            <SelectValue placeholder="Prioridade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas prioridades</SelectItem>
            <SelectItem value="urgent">Urgente</SelectItem>
            <SelectItem value="high">Alta</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="low">Baixa</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Queue list */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ListOrdered className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">Fila vazia</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Nenhuma conversa aberta ou pendente no momento</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {unassigned.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Aguardando atribuição ({unassigned.length})
              </h3>
              <div className="space-y-2">
                {unassigned.map((item, i) => (
                  <QueueRow key={item.id} item={item} position={i + 1} />
                ))}
              </div>
            </div>
          )}

          {assigned.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-primary" />
                Atribuídas ({assigned.length})
              </h3>
              <div className="space-y-2">
                {assigned.map((item, i) => (
                  <QueueRow key={item.id} item={item} position={unassigned.length + i + 1} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Assign Dialog */}
      <Dialog open={!!assignDialog} onOpenChange={(open) => !open && setAssignDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Atribuir Conversa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <Avatar className="h-10 w-10">
                {assignDialog?.contact?.profile_picture && (
                  <AvatarImage src={assignDialog.contact.profile_picture} />
                )}
                <AvatarFallback className="text-xs font-bold">
                  {getInitials(assignDialog?.contact?.name || null, assignDialog?.contact?.phone || "")}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="text-sm font-semibold">
                  {assignDialog?.contact?.name || assignDialog?.contact?.phone || "Desconhecido"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Score da fila: {assignDialog?.queueScore} pts • Espera: {formatWait(assignDialog?.waitMinutes || 0)}
                </p>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Selecionar Atendente</label>
              <p className="text-xs text-muted-foreground mb-3">
                Ordenados por menor carga de trabalho (sugestão automática)
              </p>
              <div className="space-y-2 max-h-[250px] overflow-y-auto">
                {attendants.map((att) => (
                  <div
                    key={att.user_id}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all",
                      selectedAttendant === att.user_id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-accent/50"
                    )}
                    onClick={() => setSelectedAttendant(att.user_id)}
                  >
                    <Avatar className="h-8 w-8">
                      {att.avatar_url && <AvatarImage src={att.avatar_url} />}
                      <AvatarFallback className="text-[10px] font-bold">
                        {att.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{att.name}</p>
                      <p className="text-[11px] text-muted-foreground">{att.email}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold">{att.activeCount}</p>
                      <p className="text-[9px] text-muted-foreground">ativas</p>
                    </div>
                    {attendants.indexOf(att) === 0 && (
                      <Badge variant="secondary" className="text-[9px] shrink-0">
                        Sugerido
                      </Badge>
                    )}
                  </div>
                ))}
                {attendants.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Nenhum atendente cadastrado
                  </p>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialog(null)}>
              Cancelar
            </Button>
            <Button onClick={handleAssign} disabled={!selectedAttendant || assigning}>
              {assigning ? "Atribuindo..." : "Confirmar Atribuição"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default QueuePage;
