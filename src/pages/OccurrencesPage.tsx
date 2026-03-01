import { useState } from "react";
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
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

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

  const createMutation = useMutation({
    mutationFn: async (values: OccurrenceForm) => {
      const { error } = await supabase.from("occurrences").insert(values);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["occurrences"] });
      toast.success("Ocorrência registrada com sucesso!");
      setForm(emptyForm);
      setOpen(false);
    },
    onError: () => toast.error("Erro ao registrar ocorrência"),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status, resolution }: { id: string; status: string; resolution?: string }) => {
      const updates: any = { status };
      if (status === "resolvido") {
        updates.resolved_at = new Date().toISOString();
        if (resolution) updates.resolution = resolution;
      }
      const { error } = await supabase.from("occurrences").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["occurrences"] });
      toast.success("Status atualizado!");
      setDetailOpen(false);
    },
    onError: () => toast.error("Erro ao atualizar status"),
  });

  const filtered = occurrences.filter((o: any) => {
    const matchSearch =
      !search ||
      o.store_name?.toLowerCase().includes(search.toLowerCase()) ||
      o.description?.toLowerCase().includes(search.toLowerCase()) ||
      o.contact_name?.toLowerCase().includes(search.toLowerCase());
    const matchType = filterType === "all" || o.type === filterType;
    const matchStatus = filterStatus === "all" || o.status === filterStatus;
    return matchSearch && matchType && matchStatus;
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ocorrências</h1>
          <p className="text-sm text-muted-foreground">Gerencie reclamações, sugestões, elogios e feedbacks dos clientes</p>
        </div>
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
      </div>

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
                      onClick={() => {
                        setSelectedOccurrence(occ);
                        setResolution(occ.resolution || "");
                        setDetailOpen(true);
                      }}
                    >
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
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-lg">
          {selectedOccurrence && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {(() => { const m = getTypeMeta(selectedOccurrence.type); const I = m.icon; return <I className="h-5 w-5" />; })()}
                  {getTypeMeta(selectedOccurrence.type).label} — {selectedOccurrence.store_name}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground">Data:</span> {format(new Date(selectedOccurrence.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</div>
                  <div><span className="text-muted-foreground">Prioridade:</span> {PRIORITY_OPTIONS.find((p) => p.value === selectedOccurrence.priority)?.label}</div>
                  {selectedOccurrence.contact_name && <div><span className="text-muted-foreground">Cliente:</span> {selectedOccurrence.contact_name}</div>}
                  {selectedOccurrence.contact_phone && <div><span className="text-muted-foreground">Telefone:</span> {selectedOccurrence.contact_phone}</div>}
                </div>
                <div>
                  <Label className="text-muted-foreground">Descrição</Label>
                  <p className="mt-1 rounded-md border bg-muted/50 p-3 text-sm">{selectedOccurrence.description}</p>
                </div>
                {selectedOccurrence.status !== "resolvido" && selectedOccurrence.status !== "cancelado" && (
                  <div className="space-y-3 border-t pt-3">
                    <div className="space-y-2">
                      <Label>Resolução / Observação</Label>
                      <Textarea placeholder="Descreva a resolução..." rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => updateStatusMutation.mutate({ id: selectedOccurrence.id, status: "em_andamento" })}
                      >
                        Em Andamento
                      </Button>
                      <Button
                        className="flex-1"
                        onClick={() => updateStatusMutation.mutate({ id: selectedOccurrence.id, status: "resolvido", resolution })}
                      >
                        Resolver
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
