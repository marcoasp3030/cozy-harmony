import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, Trash2, Play, AlertTriangle, CheckCircle2, Clock, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const statusConfig: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pending: { label: "Pendente", color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20", icon: Clock },
  retrying: { label: "Retentando", color: "bg-blue-500/10 text-blue-600 border-blue-500/20", icon: RefreshCw },
  delivered: { label: "Entregue", color: "bg-green-500/10 text-green-600 border-green-500/20", icon: CheckCircle2 },
  failed: { label: "Falhou", color: "bg-red-500/10 text-red-600 border-red-500/20", icon: XCircle },
};

export default function RetryQueuePanel() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"active" | "all">("active");

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["retry-queue", filter],
    queryFn: async () => {
      let query = supabase
        .from("message_retry_queue")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (filter === "active") {
        query = query.in("status", ["pending", "retrying"]);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 15000,
  });

  const retryNow = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke("message-retry", { body: {} });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Fila de retry processada");
      queryClient.invalidateQueries({ queryKey: ["retry-queue"] });
    },
    onError: () => toast.error("Erro ao processar fila"),
  });

  const clearResolved = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("message_retry_queue")
        .delete()
        .in("status", ["delivered", "failed"]);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Itens resolvidos removidos");
      queryClient.invalidateQueries({ queryKey: ["retry-queue"] });
    },
    onError: () => toast.error("Erro ao limpar fila"),
  });

  const activeCount = items.filter(i => ["pending", "retrying"].includes(i.status)).length;
  const failedCount = items.filter(i => i.status === "failed").length;
  const deliveredCount = items.filter(i => i.status === "delivered").length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Fila de Retry de Mensagens
            </CardTitle>
            <CardDescription>
              Mensagens que falharam no envio são reenviadas automaticamente com backoff exponencial (até 5 tentativas)
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFilter(f => f === "active" ? "all" : "active")}
            >
              {filter === "active" ? "Ver Todos" : "Apenas Ativos"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => retryNow.mutate()}
              disabled={retryNow.isPending}
            >
              {retryNow.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Processar Agora
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => clearResolved.mutate()}
              disabled={clearResolved.isPending}
            >
              <Trash2 className="h-4 w-4" />
              Limpar Resolvidos
            </Button>
          </div>
        </div>

        {/* Summary badges */}
        <div className="flex gap-3 mt-3">
          <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">
            <Clock className="h-3 w-3 mr-1" /> {activeCount} ativos
          </Badge>
          <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
            <CheckCircle2 className="h-3 w-3 mr-1" /> {deliveredCount} entregues
          </Badge>
          <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20">
            <XCircle className="h-3 w-3 mr-1" /> {failedCount} falhados
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <CheckCircle2 className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p>Nenhuma mensagem na fila de retry</p>
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tentativas</TableHead>
                  <TableHead>Último Erro</TableHead>
                  <TableHead>Próximo Retry</TableHead>
                  <TableHead>Criado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item: any) => {
                  const sc = statusConfig[item.status] || statusConfig.pending;
                  const Icon = sc.icon;
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-sm">{item.phone}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{item.message_type}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={sc.color}>
                          <Icon className="h-3 w-3 mr-1" />
                          {sc.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {item.attempts}/{item.max_attempts}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground" title={item.last_error || ""}>
                        {item.last_error ? (
                          <span className="flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />
                            {item.last_error}
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {item.next_retry_at && ["pending", "retrying"].includes(item.status)
                          ? formatDistanceToNow(new Date(item.next_retry_at), { addSuffix: true, locale: ptBR })
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(item.created_at), { addSuffix: true, locale: ptBR })}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
