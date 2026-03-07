import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronDown, ChevronUp, Search, Send, CheckCheck, Eye, XCircle, Users, Loader2 } from "lucide-react";

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  stats: any;
}

interface ContactRow {
  id: string;
  phone: string;
  status: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  error: string | null;
  contact_id: string | null;
}

const statusLabel: Record<string, { label: string; className: string }> = {
  sent: { label: "Enviada", className: "bg-blue-500/15 text-blue-600 border-blue-500/30" },
  delivered: { label: "Entregue", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
  read: { label: "Lida", className: "bg-primary/15 text-primary border-primary/30" },
  failed: { label: "Falha", className: "bg-destructive/15 text-destructive border-destructive/30" },
  pending: { label: "Pendente", className: "bg-muted text-muted-foreground border-border" },
};

export default function CampaignContactsReport({ campaigns }: { campaigns: CampaignRow[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ["campaign-contacts-report", expandedId],
    queryFn: async () => {
      if (!expandedId) return [];
      const { data } = await supabase
        .from("campaign_contacts")
        .select("id, phone, status, sent_at, delivered_at, read_at, error, contact_id")
        .eq("campaign_id", expandedId)
        .order("sent_at", { ascending: false });
      return (data as unknown as ContactRow[]) || [];
    },
    enabled: !!expandedId,
  });

  const filteredContacts = contacts.filter((c) => {
    if (filterStatus !== "all" && c.status !== filterStatus) return false;
    if (search && !c.phone.includes(search)) return false;
    return true;
  });

  const completedCampaigns = campaigns.filter(
    (c) => c.status === "completed" || c.status === "running" || c.status === "paused"
  );

  if (completedCampaigns.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <p className="text-sm text-muted-foreground">Nenhuma campanha executada no período.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-lg">Detalhes de Entrega por Campanha</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-4 pt-0">
        {completedCampaigns.map((campaign) => {
          const s = campaign.stats || { total: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
          const isOpen = expandedId === campaign.id;

          return (
            <div key={campaign.id} className="rounded-lg border border-border overflow-hidden">
              {/* Campaign header row */}
              <button
                className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-muted/30 hover:bg-muted/60 transition-colors text-left"
                onClick={() => setExpandedId(isOpen ? null : campaign.id)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-medium text-sm truncate">{campaign.name}</span>
                  <div className="flex items-center gap-2 text-xs shrink-0">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Users className="h-3 w-3" /> {s.total}
                    </span>
                    <span className="flex items-center gap-1 text-blue-500">
                      <Send className="h-3 w-3" /> {s.sent}
                    </span>
                    <span className="flex items-center gap-1 text-emerald-500">
                      <CheckCheck className="h-3 w-3" /> {s.delivered}
                    </span>
                    <span className="flex items-center gap-1 text-primary">
                      <Eye className="h-3 w-3" /> {s.read}
                    </span>
                    {s.failed > 0 && (
                      <span className="flex items-center gap-1 text-destructive">
                        <XCircle className="h-3 w-3" /> {s.failed}
                      </span>
                    )}
                  </div>
                </div>
                {isOpen ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
              </button>

              {/* Expanded contacts */}
              {isOpen && (
                <div className="border-t border-border">
                  {/* Filters */}
                  <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-background">
                    <div className="relative flex-1 min-w-[200px]">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Buscar telefone..."
                        className="h-8 pl-8 text-xs"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <div className="flex gap-1">
                      {[
                        { value: "all", label: "Todos" },
                        { value: "sent", label: "Enviadas" },
                        { value: "delivered", label: "Entregues" },
                        { value: "read", label: "Lidas" },
                        { value: "failed", label: "Falhas" },
                      ].map((f) => (
                        <Button
                          key={f.value}
                          variant={filterStatus === f.value ? "default" : "outline"}
                          size="sm"
                          className="h-7 text-[11px]"
                          onClick={() => setFilterStatus(f.value)}
                        >
                          {f.label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <ScrollArea className="max-h-[400px]">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border bg-muted/50">
                            <th className="text-left px-4 py-2 font-medium">Telefone</th>
                            <th className="text-left px-4 py-2 font-medium">Status</th>
                            <th className="text-left px-4 py-2 font-medium">Enviada em</th>
                            <th className="text-left px-4 py-2 font-medium">Entregue em</th>
                            <th className="text-left px-4 py-2 font-medium">Lida em</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {filteredContacts.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                                Nenhum contato encontrado.
                              </td>
                            </tr>
                          ) : (
                            filteredContacts.slice(0, 200).map((c) => {
                              const sl = statusLabel[c.status] || statusLabel.pending;
                              return (
                                <tr key={c.id} className="hover:bg-muted/30">
                                  <td className="px-4 py-2 font-mono">{c.phone}</td>
                                  <td className="px-4 py-2">
                                    <Badge variant="outline" className={`text-[10px] ${sl.className}`}>
                                      {sl.label}
                                    </Badge>
                                  </td>
                                  <td className="px-4 py-2 text-muted-foreground">
                                    {c.sent_at ? new Date(c.sent_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                                  </td>
                                  <td className="px-4 py-2 text-muted-foreground">
                                    {c.delivered_at ? new Date(c.delivered_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                                  </td>
                                  <td className="px-4 py-2 text-muted-foreground">
                                    {c.read_at ? new Date(c.read_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                      {filteredContacts.length > 200 && (
                        <p className="px-4 py-2 text-xs text-muted-foreground">
                          Exibindo 200 de {filteredContacts.length} contatos.
                        </p>
                      )}
                    </ScrollArea>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
