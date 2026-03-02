import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Plus,
  Search,
  Filter,
  MessageSquareWarning,
  ThumbsUp,
  Lightbulb,
  HelpCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  ShieldAlert,
  PackageX,
  CalendarX,
  Trash2,
  CreditCard,
  Zap,
  DoorClosed,
  Pencil,
  Save,
  X,
  History,
  Download,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { format, isAfter, isBefore, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import * as XLSX from "xlsx";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const OCCURRENCE_TYPES = [
  { value: "elogio", label: "Elogio", icon: ThumbsUp, color: "bg-emerald-500/15 text-emerald-600" },
  { value: "reclamacao", label: "Reclamação", icon: MessageSquareWarning, color: "bg-destructive/15 text-destructive" },
  { value: "furto", label: "Furto", icon: ShieldAlert, color: "bg-red-600/15 text-red-700" },
  { value: "falta_produto", label: "Falta de Produto", icon: PackageX, color: "bg-orange-500/15 text-orange-600" },
  { value: "produto_vencido", label: "Produto Vencido", icon: CalendarX, color: "bg-rose-500/15 text-rose-600" },
  { value: "loja_suja", label: "Loja Suja", icon: Trash2, color: "bg-amber-600/15 text-amber-700" },
  { value: "problema_pagamento", label: "Problema Pagamento", icon: CreditCard, color: "bg-violet-500/15 text-violet-600" },
  { value: "loja_sem_energia", label: "Sem Energia", icon: Zap, color: "bg-yellow-500/15 text-yellow-700" },
  { value: "acesso_bloqueado", label: "Acesso Bloqueado", icon: DoorClosed, color: "bg-slate-500/15 text-slate-600" },
  { value: "sugestao", label: "Sugestão", icon: Lightbulb, color: "bg-amber-500/15 text-amber-600" },
  { value: "duvida", label: "Dúvida", icon: HelpCircle, color: "bg-blue-500/15 text-blue-600" },
  { value: "outro", label: "Outro", icon: AlertTriangle, color: "bg-muted text-muted-foreground" },
];

const STATUS_OPTIONS = [
  { value: "aberto", label: "Aberto", icon: Clock, color: "bg-amber-500/15 text-amber-600" },
  { value: "em_andamento", label: "Em andamento", icon: AlertTriangle, color: "bg-blue-500/15 text-blue-600" },
  { value: "resolvido", label: "Resolvido", icon: CheckCircle2, color: "bg-emerald-500/15 text-emerald-600" },
  { value: "cancelado", label: "Cancelado", icon: XCircle, color: "bg-muted text-muted-foreground" },
];

const PRIORITY_OPTIONS = [
  { value: "baixa", label: "Baixa" },
  { value: "normal", label: "Normal" },
  { value: "alta", label: "Alta" },
  { value: "urgente", label: "Urgente" },
];

interface OccurrenceForm {
  store_name: string;
  type: string;
  description: string;
  contact_phone: string;
  contact_name: string;
  priority: string;
}

const emptyForm: OccurrenceForm = {
  store_name: "",
  type: "reclamacao",
  description: "",
  contact_phone: "",
  contact_name: "",
  priority: "normal",
};

const ACTION_LABELS: Record<string, string> = {
  created: "Criou a ocorrência",
  status_change: "Alterou o status",
  edited: "Editou campos",
  reopened: "Reabriu a ocorrência",
  deleted: "Excluiu a ocorrência",
};

const getUserProfile = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { id: null, name: "Sistema" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("name")
    .eq("user_id", user.id)
    .single();
  return { id: user.id, name: profile?.name || user.email || "Usuário" };
};

const recordHistory = async (occurrenceId: string, action: string, changes: Record<string, any>) => {
  const user = await getUserProfile();
  await supabase.from("occurrence_history" as any).insert({
    occurrence_id: occurrenceId,
    user_id: user.id,
    user_name: user.name,
    action,
    changes,
  } as any);
};

const OccurrencesPage = () => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedOccurrence, setSelectedOccurrence] = useState<any>(null);
  const [form, setForm] = useState<OccurrenceForm>(emptyForm);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [resolution, setResolution] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ contact_name: "", contact_phone: "", priority: "", type: "" });
  const [showHistory, setShowHistory] = useState(false);
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sendSurveyOnResolve, setSendSurveyOnResolve] = useState(false);

  const { data: occurrences = [], isLoading } = useQuery({
    queryKey: ["occurrences"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("occurrences")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: history = [], refetch: refetchHistory } = useQuery({
    queryKey: ["occurrence_history", selectedOccurrence?.id],
    queryFn: async () => {
      if (!selectedOccurrence?.id) return [];
      const { data, error } = await supabase
        .from("occurrence_history" as any)
        .select("*")
        .eq("occurrence_id", selectedOccurrence.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!selectedOccurrence?.id && detailOpen,
  });

  const createMutation = useMutation({
    mutationFn: async (values: OccurrenceForm) => {
      const { data, error } = await supabase.from("occurrences").insert(values).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      recordHistory(data.id, "created", { store_name: data.store_name, type: data.type, priority: data.priority });
      queryClient.invalidateQueries({ queryKey: ["occurrences"] });
      toast.success("Ocorrência registrada com sucesso!");
      setForm(emptyForm);
      setOpen(false);
    },
    onError: () => toast.error("Erro ao registrar ocorrência"),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status, resolution, sendSurvey, contactPhone, contactName }: { id: string; status: string; resolution?: string; sendSurvey?: boolean; contactPhone?: string; contactName?: string }) => {
      const updates: any = { status };
      if (status === "resolvido") {
        updates.resolved_at = new Date().toISOString();
        if (resolution) updates.resolution = resolution;
      }
      if (status === "aberto") {
        updates.resolved_at = null;
        updates.resolution = null;
      }
      const { error } = await supabase.from("occurrences").update(updates).eq("id", id);
      if (error) throw error;

      // Send satisfaction survey via Edge Function
      if (sendSurvey && contactPhone && status === "resolvido") {
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const accessToken = sessionData?.session?.access_token;
          if (accessToken) {
            const surveyResp = await supabase.functions.invoke("send-survey", {
              body: { contactPhone, contactName: contactName || "cliente" },
            });
            if (surveyResp.error) {
              console.error("Survey error:", surveyResp.error);
              toast.error("Erro ao enviar pesquisa: " + (surveyResp.error.message || "Verifique as configurações"));
            } else {
              toast.success("Pesquisa de satisfação enviada!");
            }
          }
        } catch (surveyErr) {
          console.error("Failed to send survey:", surveyErr);
          toast.error("Erro ao enviar pesquisa de satisfação");
        }
      }

      return { id, status, resolution };
    },
    onSuccess: (result) => {
      const action = result.status === "aberto" ? "reopened" : "status_change";
      const oldStatus = selectedOccurrence?.status;
      recordHistory(result.id, action, {
        from_status: STATUS_OPTIONS.find(s => s.value === oldStatus)?.label || oldStatus,
        to_status: STATUS_OPTIONS.find(s => s.value === result.status)?.label || result.status,
        ...(result.resolution ? { resolution: result.resolution } : {}),
      });
      queryClient.invalidateQueries({ queryKey: ["occurrences"] });
      queryClient.invalidateQueries({ queryKey: ["occurrence_history"] });
      toast.success("Status atualizado!");
      setDetailOpen(false);
    },
    onError: () => toast.error("Erro ao atualizar status"),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, ...fields }: { id: string; contact_name: string; contact_phone: string; priority: string; type: string }) => {
      const { error } = await supabase.from("occurrences").update(fields).eq("id", id);
      if (error) throw error;
      return { id, fields };
    },
    onSuccess: (result) => {
      const changes: Record<string, any> = {};
      const old = selectedOccurrence;
      if (old.contact_name !== result.fields.contact_name) changes.contact_name = { de: old.contact_name || "—", para: result.fields.contact_name };
      if (old.contact_phone !== result.fields.contact_phone) changes.contact_phone = { de: old.contact_phone || "—", para: result.fields.contact_phone };
      if (old.priority !== result.fields.priority) changes.priority = { de: PRIORITY_OPTIONS.find(p => p.value === old.priority)?.label, para: PRIORITY_OPTIONS.find(p => p.value === result.fields.priority)?.label };
      if (old.type !== result.fields.type) changes.type = { de: OCCURRENCE_TYPES.find(t => t.value === old.type)?.label, para: OCCURRENCE_TYPES.find(t => t.value === result.fields.type)?.label };
      if (Object.keys(changes).length > 0) {
        recordHistory(result.id, "edited", changes);
      }
      queryClient.invalidateQueries({ queryKey: ["occurrences"] });
      queryClient.invalidateQueries({ queryKey: ["occurrence_history"] });
      toast.success("Ocorrência atualizada!");
      setIsEditing(false);
      setDetailOpen(false);
    },
    onError: () => toast.error("Erro ao atualizar ocorrência"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("occurrences").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["occurrences"] });
      toast.success("Ocorrência excluída!");
      setDetailOpen(false);
    },
    onError: () => toast.error("Erro ao excluir ocorrência"),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from("occurrences").delete().in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["occurrences"] });
      toast.success(`${selectedIds.size} ocorrências excluídas!`);
      setSelectedIds(new Set());
    },
    onError: () => toast.error("Erro ao excluir ocorrências"),
  });

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((o: any) => o.id)));
    }
  };

  const filtered = occurrences.filter((o: any) => {
    const matchSearch =
      !search ||
      o.store_name?.toLowerCase().includes(search.toLowerCase()) ||
      o.description?.toLowerCase().includes(search.toLowerCase()) ||
      o.contact_name?.toLowerCase().includes(search.toLowerCase());
    const matchType = filterType === "all" || o.type === filterType;
    const matchStatus = filterStatus === "all" || o.status === filterStatus;
    const occDate = new Date(o.created_at);
    const matchDateFrom = !dateFrom || !isBefore(occDate, startOfDay(dateFrom));
    const matchDateTo = !dateTo || !isAfter(occDate, endOfDay(dateTo));
    return matchSearch && matchType && matchStatus && matchDateFrom && matchDateTo;
  });

  const stats = {
    total: occurrences.length,
    aberto: occurrences.filter((o: any) => o.status === "aberto").length,
    em_andamento: occurrences.filter((o: any) => o.status === "em_andamento").length,
    resolvido: occurrences.filter((o: any) => o.status === "resolvido").length,
  };

  const getTypeMeta = (type: string) => OCCURRENCE_TYPES.find((t) => t.value === type) || OCCURRENCE_TYPES[OCCURRENCE_TYPES.length - 1];
  const getStatusMeta = (status: string) => STATUS_OPTIONS.find((s) => s.value === status) || STATUS_OPTIONS[0];
  const getPriorityColor = (p: string) => {
    if (p === "urgente") return "bg-destructive text-destructive-foreground";
    if (p === "alta") return "bg-amber-500/15 text-amber-600";
    return "bg-muted text-muted-foreground";
  };

  const exportToExcel = () => {
    const rows = filtered.map((o: any) => ({
      "Data": format(new Date(o.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR }),
      "Loja": o.store_name,
      "Tipo": OCCURRENCE_TYPES.find(t => t.value === o.type)?.label || o.type,
      "Cliente": o.contact_name || "—",
      "Telefone": o.contact_phone || "—",
      "Prioridade": PRIORITY_OPTIONS.find(p => p.value === o.priority)?.label || o.priority,
      "Status": STATUS_OPTIONS.find(s => s.value === o.status)?.label || o.status,
      "Descrição": o.description,
      "Resolução": o.resolution || "",
      "Resolvido em": o.resolved_at ? format(new Date(o.resolved_at), "dd/MM/yyyy HH:mm", { locale: ptBR }) : "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ocorrências");
    XLSX.writeFile(wb, `ocorrencias_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
    toast.success(`${rows.length} ocorrências exportadas!`);
  };

  const formatChanges = (entry: any) => {
    const changes = entry.changes || {};
    if (entry.action === "created") {
      return `Loja: ${changes.store_name || "—"} | Tipo: ${OCCURRENCE_TYPES.find(t => t.value === changes.type)?.label || changes.type} | Prioridade: ${PRIORITY_OPTIONS.find(p => p.value === changes.priority)?.label || changes.priority}`;
    }
    if (entry.action === "status_change" || entry.action === "reopened") {
      return `${changes.from_status} → ${changes.to_status}${changes.resolution ? ` | Resolução: ${changes.resolution}` : ""}`;
    }
    if (entry.action === "edited") {
      return Object.entries(changes).map(([key, val]: [string, any]) => {
        const label = key === "contact_name" ? "Cliente" : key === "contact_phone" ? "Telefone" : key === "priority" ? "Prioridade" : key === "type" ? "Tipo" : key;
        return `${label}: ${val.de} → ${val.para}`;
      }).join(" | ");
    }
    return JSON.stringify(changes);
  };

  return (
    <div className="space-y-6">
      {/* Header + create dialog */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ocorrências</h1>
          <p className="text-sm text-muted-foreground">Gerencie reclamações, sugestões, elogios e feedbacks dos clientes</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportToExcel} disabled={filtered.length === 0}>
            <Download className="mr-2 h-4 w-4" /> Exportar
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" /> Nova Ocorrência</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Registrar Ocorrência</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Nome da Loja *</Label>
                <Input placeholder="Ex: Condomínio Parque Verde" value={form.store_name} onChange={(e) => setForm({ ...form, store_name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tipo *</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OCCURRENCE_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Prioridade</Label>
                  <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PRIORITY_OPTIONS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nome do Cliente</Label>
                  <Input placeholder="Opcional" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Telefone</Label>
                  <Input placeholder="Opcional" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Descrição *</Label>
                <Textarea placeholder="Descreva a ocorrência em detalhes..." rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <Button
                className="w-full"
                disabled={!form.store_name || !form.description || createMutation.isPending}
                onClick={() => createMutation.mutate(form)}
              >
                {createMutation.isPending ? "Registrando..." : "Registrar Ocorrência"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{stats.total}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-amber-600">Abertos</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{stats.aberto}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-blue-600">Em Andamento</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{stats.em_andamento}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-emerald-600">Resolvidos</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{stats.resolvido}</p></CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar por loja, descrição ou cliente..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[160px]"><Filter className="mr-2 h-4 w-4" /><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {OCCURRENCE_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("w-[140px] justify-start text-left font-normal", !dateFrom && "text-muted-foreground")}>
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dateFrom ? format(dateFrom, "dd/MM/yyyy") : "Data início"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} initialFocus className="p-3 pointer-events-auto" />
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("w-[140px] justify-start text-left font-normal", !dateTo && "text-muted-foreground")}>
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dateTo ? format(dateTo, "dd/MM/yyyy") : "Data fim"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={dateTo} onSelect={setDateTo} initialFocus className="p-3 pointer-events-auto" />
          </PopoverContent>
        </Popover>
        {(dateFrom || dateTo) && (
          <Button variant="ghost" size="icon" onClick={() => { setDateFrom(undefined); setDateTo(undefined); }}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3">
          <span className="text-sm font-medium">{selectedIds.size} selecionada(s)</span>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Excluir selecionadas
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir {selectedIds.size} ocorrências?</AlertDialogTitle>
                <AlertDialogDescription>Esta ação não pode ser desfeita. Todas as ocorrências selecionadas serão removidas permanentemente.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => bulkDeleteMutation.mutate(Array.from(selectedIds))}>Excluir</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Limpar seleção</Button>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <MessageSquareWarning className="mb-2 h-10 w-10" />
              <p>Nenhuma ocorrência encontrada</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={filtered.length > 0 && selectedIds.size === filtered.length}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Loja</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="hidden md:table-cell">Cliente</TableHead>
                  <TableHead>Prioridade</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((occ: any) => {
                  const typeMeta = getTypeMeta(occ.type);
                  const statusMeta = getStatusMeta(occ.status);
                  const TypeIcon = typeMeta.icon;
                  return (
                    <TableRow
                      key={occ.id}
                      className="cursor-pointer"
                      data-state={selectedIds.has(occ.id) ? "selected" : undefined}
                      onClick={() => {
                        setSelectedOccurrence(occ);
                        setResolution(occ.resolution || "");
                        setShowHistory(false);
                        setDetailOpen(true);
                      }}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(occ.id)}
                          onCheckedChange={() => toggleSelect(occ.id)}
                        />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(occ.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                      </TableCell>
                      <TableCell className="font-medium">{occ.store_name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={typeMeta.color}>
                          <TypeIcon className="mr-1 h-3 w-3" />{typeMeta.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground">{occ.contact_name || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={getPriorityColor(occ.priority)}>
                          {PRIORITY_OPTIONS.find((p) => p.value === occ.priority)?.label || occ.priority}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusMeta.color}>{statusMeta.label}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={(v) => { setDetailOpen(v); if (!v) { setIsEditing(false); setShowHistory(false); } }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          {selectedOccurrence && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {(() => { const m = getTypeMeta(selectedOccurrence.type); const I = m.icon; return <I className="h-5 w-5" />; })()}
                  {getTypeMeta(selectedOccurrence.type).label} — {selectedOccurrence.store_name}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                {/* Action buttons */}
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => setShowHistory(!showHistory)}>
                    <History className="mr-1 h-3.5 w-3.5" /> Histórico
                  </Button>
                  {!isEditing ? (
                    <Button variant="outline" size="sm" onClick={() => {
                      setEditForm({
                        contact_name: selectedOccurrence.contact_name || "",
                        contact_phone: selectedOccurrence.contact_phone || "",
                        priority: selectedOccurrence.priority || "normal",
                        type: selectedOccurrence.type || "reclamacao",
                      });
                      setIsEditing(true);
                    }}>
                      <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
                    </Button>
                  ) : (
                    <>
                      <Button variant="outline" size="sm" onClick={() => setIsEditing(false)}>
                        <X className="mr-1 h-3.5 w-3.5" /> Cancelar
                      </Button>
                      <Button size="sm" disabled={editMutation.isPending} onClick={() => editMutation.mutate({ id: selectedOccurrence.id, ...editForm })}>
                        <Save className="mr-1 h-3.5 w-3.5" /> Salvar
                      </Button>
                    </>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="sm"><Trash2 className="mr-1 h-3.5 w-3.5" /> Excluir</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Excluir ocorrência?</AlertDialogTitle>
                        <AlertDialogDescription>Esta ação não pode ser desfeita. A ocorrência será removida permanentemente.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteMutation.mutate(selectedOccurrence.id)}>Excluir</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>

                {/* History Panel */}
                {showHistory && (
                  <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Histórico de Alterações</Label>
                    {history.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">Nenhuma alteração registrada.</p>
                    ) : (
                      <ScrollArea className="max-h-48">
                        <div className="space-y-2">
                          {history.map((entry: any, idx: number) => (
                            <div key={entry.id || idx}>
                              <div className="flex items-start gap-2 text-xs">
                                <span className="text-muted-foreground whitespace-nowrap">
                                  {format(new Date(entry.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                                </span>
                                <div className="flex-1">
                                  <span className="font-medium">{entry.user_name || "Sistema"}</span>
                                  <span className="text-muted-foreground"> — {ACTION_LABELS[entry.action] || entry.action}</span>
                                  <p className="text-muted-foreground mt-0.5">{formatChanges(entry)}</p>
                                </div>
                              </div>
                              {idx < history.length - 1 && <Separator className="mt-2" />}
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </div>
                )}

                {isEditing ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Nome do Cliente</Label>
                        <Input value={editForm.contact_name} onChange={(e) => setEditForm({ ...editForm, contact_name: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Telefone</Label>
                        <Input value={editForm.contact_phone} onChange={(e) => setEditForm({ ...editForm, contact_phone: e.target.value })} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Tipo</Label>
                        <Select value={editForm.type} onValueChange={(v) => setEditForm({ ...editForm, type: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {OCCURRENCE_TYPES.map((t) => (
                              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Prioridade</Label>
                        <Select value={editForm.priority} onValueChange={(v) => setEditForm({ ...editForm, priority: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {PRIORITY_OPTIONS.map((p) => (
                              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><span className="text-muted-foreground">Data:</span> {format(new Date(selectedOccurrence.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</div>
                    <div><span className="text-muted-foreground">Prioridade:</span> {PRIORITY_OPTIONS.find((p) => p.value === selectedOccurrence.priority)?.label}</div>
                    {selectedOccurrence.contact_name && <div><span className="text-muted-foreground">Cliente:</span> {selectedOccurrence.contact_name}</div>}
                    {selectedOccurrence.contact_phone && <div><span className="text-muted-foreground">Telefone:</span> {selectedOccurrence.contact_phone}</div>}
                  </div>
                )}

                <div>
                  <Label className="text-muted-foreground">Descrição</Label>
                  <p className="mt-1 rounded-md border bg-muted/50 p-3 text-sm">{selectedOccurrence.description}</p>
                </div>

                {/* Status actions */}
                {!isEditing && (selectedOccurrence.status === "resolvido" || selectedOccurrence.status === "cancelado") && (
                  <div className="border-t pt-3">
                    <Button variant="outline" className="w-full" onClick={() => updateStatusMutation.mutate({ id: selectedOccurrence.id, status: "aberto" })}>
                      <Clock className="mr-2 h-4 w-4" /> Reabrir Ocorrência
                    </Button>
                  </div>
                )}
                {selectedOccurrence.status !== "resolvido" && selectedOccurrence.status !== "cancelado" && !isEditing && (
                  <div className="space-y-3 border-t pt-3">
                    <div className="space-y-2">
                      <Label>Resolução / Observação</Label>
                      <Textarea placeholder="Descreva a resolução..." rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} />
                    </div>
                    {selectedOccurrence.contact_phone && (
                      <div className="flex items-center gap-2 rounded-lg border p-2.5">
                        <Checkbox
                          id="send-survey"
                          checked={sendSurveyOnResolve}
                          onCheckedChange={(v) => setSendSurveyOnResolve(!!v)}
                        />
                        <Label htmlFor="send-survey" className="text-sm cursor-pointer flex-1">
                          Enviar pesquisa de satisfação ao resolver
                        </Label>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={() => updateStatusMutation.mutate({ id: selectedOccurrence.id, status: "em_andamento" })}>
                        Em Andamento
                      </Button>
                      <Button className="flex-1" onClick={() => updateStatusMutation.mutate({
                        id: selectedOccurrence.id,
                        status: "resolvido",
                        resolution,
                        sendSurvey: sendSurveyOnResolve,
                        contactPhone: selectedOccurrence.contact_phone,
                        contactName: selectedOccurrence.contact_name,
                      })}>
                        <CheckCircle2 className="mr-1.5 h-4 w-4" /> Resolver
                      </Button>
                      <Button variant="outline" className="flex-1 text-destructive" onClick={() => updateStatusMutation.mutate({ id: selectedOccurrence.id, status: "cancelado" })}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}
                {selectedOccurrence.resolution && (
                  <div>
                    <Label className="text-muted-foreground">Resolução</Label>
                    <p className="mt-1 rounded-md border bg-emerald-500/5 p-3 text-sm">{selectedOccurrence.resolution}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default OccurrencesPage;
