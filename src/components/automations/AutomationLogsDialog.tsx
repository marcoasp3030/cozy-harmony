import { useState, useEffect } from "react";
import { History, Clock, CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronRight, Phone, Send, ExternalLink, ShieldCheck, CreditCard, Ban, FileSearch } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface NodeLogEntry {
  nodeId: string;
  nodeType: string;
  nodeLabel: string;
  status: "success" | "error" | "skipped";
  result?: any;
  error?: string;
  startedAt: string;
  durationMs: number;
}

interface AutomationLog {
  id: string;
  automation_id: string;
  contact_id: string | null;
  contact_phone: string | null;
  trigger_type: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  nodes_executed: NodeLogEntry[];
  error: string | null;
  created_at: string;
}

interface Props {
  automationId: string;
  automationName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const statusConfig = {
  completed: { icon: CheckCircle2, label: "Concluído", color: "text-green-500", bg: "bg-green-500/10" },
  error: { icon: XCircle, label: "Erro", color: "text-red-500", bg: "bg-red-500/10" },
  running: { icon: Clock, label: "Executando", color: "text-yellow-500", bg: "bg-yellow-500/10" },
};

const AUDIT_LABELS: Record<string, { label: string; icon: typeof CreditCard; color: string; bg: string }> = {
  _audit_pix_auto_sent: { label: "PIX Enviado", icon: CreditCard, color: "text-green-500", bg: "bg-green-500/10" },
  _audit_reply_suppressed: { label: "Resposta Suprimida", icon: Ban, color: "text-amber-500", bg: "bg-amber-500/10" },
  _audit_guard_block: { label: "Preço Bloqueado", icon: ShieldCheck, color: "text-red-500", bg: "bg-red-500/10" },
  _audit_payment_verify: { label: "Comprovante Verificado", icon: FileSearch, color: "text-blue-500", bg: "bg-blue-500/10" },
  _pix_key_sent: { label: "Chave PIX", icon: CreditCard, color: "text-primary", bg: "bg-primary/10" },
};

function AuditTrailPanel({ result }: { result: Record<string, string> }) {
  if (!result || typeof result !== "object") return null;
  const entries = Object.entries(result).filter(([k]) => k.startsWith("_audit_") || k === "_pix_key_sent");
  if (entries.length === 0) return null;

  return (
    <div className="space-y-1.5 px-2 pb-2 pl-9">
      {entries.map(([key, value]) => {
        const config = AUDIT_LABELS[key] || { label: key, icon: ShieldCheck, color: "text-muted-foreground", bg: "bg-muted" };
        const Icon = config.icon;
        let displayValue = String(value);

        if (key === "_audit_payment_verify") {
          try {
            const parsed = JSON.parse(displayValue);
            displayValue = `Veredito: ${parsed.verdict || "N/A"} | Pagador: ${parsed.payer || "N/A"} | Valor: ${parsed.amount || "N/A"}`;
          } catch {}
        }

        if (key === "_pix_key_sent") {
          displayValue = value === "true" ? "✅ Enviada nesta execução" : "❌ Não enviada";
        }

        return (
          <div key={key} className={`flex items-start gap-2 rounded-lg p-2 ${config.bg} border border-border/50`}>
            <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${config.color}`} />
            <div className="min-w-0 flex-1">
              <p className={`text-[11px] font-semibold ${config.color}`}>{config.label}</p>
              <p className="text-[10px] text-muted-foreground break-words leading-relaxed">{displayValue}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function AutomationLogsDialog({ automationId, automationName, open, onOpenChange }: Props) {
  const [logs, setLogs] = useState<AutomationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);

    const fetchLogs = async () => {
      const { data } = await supabase
        .from("automation_logs")
        .select("*")
        .eq("automation_id", automationId)
        .order("created_at", { ascending: false })
        .limit(50);

      setLogs((data as any as AutomationLog[]) || []);
      setLoading(false);
    };

    fetchLogs();

    const channel = supabase
      .channel(`automation-logs-${automationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "automation_logs", filter: `automation_id=eq.${automationId}` },
        () => fetchLogs()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [open, automationId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            Histórico — {automationName}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Clock className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <History className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">Nenhuma execução registrada ainda</p>
            </div>
          ) : (
            <div className="space-y-2 pb-4">
              {logs.map((log) => {
                const config = statusConfig[log.status as keyof typeof statusConfig] || statusConfig.running;
                const StatusIcon = config.icon;
                const isExpanded = expandedLog === log.id;
                const nodesExecuted = Array.isArray(log.nodes_executed) ? log.nodes_executed : [];
                const hasAudit = nodesExecuted.some((n) => n.nodeType === "audit_trail");

                return (
                  <div key={log.id} className="border rounded-lg overflow-hidden">
                    <button
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
                      onClick={() => setExpandedLog(isExpanded ? null : log.id)}
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                      <div className={`flex h-7 w-7 items-center justify-center rounded-full shrink-0 ${config.bg}`}>
                        <StatusIcon className={`h-3.5 w-3.5 ${config.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{config.label}</span>
                          {log.contact_phone && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {log.contact_phone}
                            </span>
                          )}
                          {hasAudit && (
                            <Badge variant="outline" className="text-[9px] h-4 gap-0.5 border-primary/30 text-primary">
                              <ShieldCheck className="h-2.5 w-2.5" />
                              Auditoria
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{formatDistanceToNow(new Date(log.started_at), { addSuffix: true, locale: ptBR })}</span>
                          {log.duration_ms != null && <span>• {log.duration_ms}ms</span>}
                          <span>• {nodesExecuted.filter(n => n.nodeType !== "audit_trail").length} nós</span>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {log.trigger_type}
                      </Badge>
                    </button>

                    {isExpanded && (
                      <div className="border-t bg-muted/20 px-4 py-3 space-y-2">
                        {log.error && (
                          <div className="flex items-start gap-2 p-2 rounded bg-red-500/10 border border-red-500/20">
                            <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                            <p className="text-xs text-red-400">{log.error}</p>
                          </div>
                        )}

                        {nodesExecuted.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic">Nenhum nó executado</p>
                        ) : (
                          <div className="space-y-1">
                            {nodesExecuted.map((node, idx) => {
                              if (node.nodeType === "audit_trail") {
                                return (
                                  <div key={`audit-${idx}`} className="rounded-lg bg-background/50 text-xs border border-primary/10">
                                    <div className="flex items-center gap-2 px-2 py-1.5">
                                      <span className="text-muted-foreground w-5 text-right shrink-0">🔍</span>
                                      <ShieldCheck className="h-3.5 w-3.5 text-primary shrink-0" />
                                      <span className="font-semibold text-primary">{node.nodeLabel}</span>
                                    </div>
                                    <AuditTrailPanel result={node.result} />
                                  </div>
                                );
                              }

                              const hasSendResult = node.result?.messageId !== undefined || node.result?.httpStatus !== undefined || node.result?.sent !== undefined;
                              return (
                                <div key={`${node.nodeId}-${idx}`} className="rounded bg-background/50 text-xs">
                                  <div className="flex items-center gap-2 px-2 py-1.5">
                                    <span className="text-muted-foreground w-5 text-right shrink-0">{idx + 1}</span>
                                    {node.status === "success" ? (
                                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                                    ) : (
                                      <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                                    )}
                                    <span className="font-medium">{node.nodeLabel}</span>
                                    {node.result?.condition !== undefined && (
                                      <Badge variant={node.result.condition ? "default" : "secondary"} className="text-[9px] h-4">
                                        {node.result.condition ? "Sim" : "Não"}
                                      </Badge>
                                    )}
                                    <span className="text-muted-foreground ml-auto">{node.durationMs}ms</span>
                                    {node.error && (
                                      <span className="text-red-400 truncate max-w-[200px]" title={node.error}>{node.error}</span>
                                    )}
                                  </div>
                                  {hasSendResult && (
                                    <div className="flex items-center gap-2 px-2 pb-1.5 pl-9 flex-wrap">
                                      {node.result?.sent !== undefined && (
                                        <Badge variant={node.result.sent ? "default" : "secondary"} className="text-[9px] h-4 gap-1">
                                          <Send className="h-2.5 w-2.5" />
                                          {node.result.sent ? "Enviado" : "Não enviado"}
                                        </Badge>
                                      )}
                                      {node.result?.httpStatus && (
                                        <Badge variant="outline" className="text-[9px] h-4">HTTP {node.result.httpStatus}</Badge>
                                      )}
                                      {node.result?.messageId && (
                                        <span className="text-[10px] text-muted-foreground flex items-center gap-0.5" title={node.result.messageId}>
                                          <ExternalLink className="h-2.5 w-2.5" />
                                          ID: {String(node.result.messageId).slice(0, 16)}…
                                        </span>
                                      )}
                                      {node.result?.reason && (
                                        <span className="text-[10px] text-amber-500">
                                          {node.result.reason === "empty_message" ? "Mensagem vazia" : 
                                           node.result.reason === "template_not_found" ? "Template não encontrado" : 
                                           node.result.reason}
                                        </span>
                                      )}
                                      {node.result?.template && (
                                        <span className="text-[10px] text-muted-foreground">Template: {node.result.template}</span>
                                      )}
                                    </div>
                                  )}
                                  {node.result?.apiResponse && (
                                    <div className="px-2 pb-1.5 pl-9">
                                      <details className="text-[10px]">
                                        <summary className="text-muted-foreground cursor-pointer hover:text-foreground">Ver resposta da API</summary>
                                        <pre className="mt-1 p-1.5 rounded bg-muted/50 text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all max-h-20">
                                          {node.result.apiResponse}
                                        </pre>
                                      </details>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}