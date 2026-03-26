import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Building2, Users, Wifi, WifiOff, MessageSquare, Phone,
  TrendingUp, Activity, Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface OrgData {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
  memberCount: number;
  instanceCount: number;
  connectedInstances: number;
  contactCount: number;
  conversationCount: number;
  campaignCount: number;
}

const AdminTenantDashboard = () => {
  const { data: orgs, isLoading } = useQuery({
    queryKey: ["admin-tenant-overview"],
    queryFn: async () => {
      // Fetch all orgs
      const { data: organizations } = await supabase
        .from("organizations")
        .select("id, name, slug, is_active, created_at")
        .order("created_at", { ascending: false });

      if (!organizations || organizations.length === 0) return [];

      // Fetch counts per org in parallel
      const orgIds = organizations.map((o) => o.id);

      const [
        { data: members },
        { data: instances },
        { data: contacts },
        { data: conversations },
        { data: campaigns },
      ] = await Promise.all([
        supabase.from("organization_members").select("org_id").in("org_id", orgIds),
        supabase.from("whatsapp_instances").select("org_id, status").in("org_id", orgIds),
        supabase.from("contacts").select("org_id").in("org_id", orgIds),
        supabase.from("conversations").select("org_id").in("org_id", orgIds),
        supabase.from("campaigns").select("org_id").in("org_id", orgIds),
      ]);

      return organizations.map((org): OrgData => {
        const orgMembers = members?.filter((m) => m.org_id === org.id) || [];
        const orgInstances = instances?.filter((i) => i.org_id === org.id) || [];
        const orgContacts = contacts?.filter((c) => c.org_id === org.id) || [];
        const orgConvs = conversations?.filter((c) => c.org_id === org.id) || [];
        const orgCamps = campaigns?.filter((c) => c.org_id === org.id) || [];

        return {
          ...org,
          memberCount: orgMembers.length,
          instanceCount: orgInstances.length,
          connectedInstances: orgInstances.filter((i) => (i as any).status === "connected").length,
          contactCount: orgContacts.length,
          conversationCount: orgConvs.length,
          campaignCount: orgCamps.length,
        };
      });
    },
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!orgs || orgs.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma organização cadastrada.
        </CardContent>
      </Card>
    );
  }

  const totalOrgs = orgs.length;
  const activeOrgs = orgs.filter((o) => o.is_active).length;
  const totalMembers = orgs.reduce((a, o) => a + o.memberCount, 0);
  const totalInstances = orgs.reduce((a, o) => a + o.instanceCount, 0);
  const totalConnected = orgs.reduce((a, o) => a + o.connectedInstances, 0);
  const totalContacts = orgs.reduce((a, o) => a + o.contactCount, 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="font-heading text-lg">Painel Multi-Tenant</CardTitle>
              <CardDescription>Visão geral de todas as organizações</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
            {[
              { label: "Empresas", value: totalOrgs, icon: Building2 },
              { label: "Ativas", value: activeOrgs, icon: Activity },
              { label: "Usuários", value: totalMembers, icon: Users },
              { label: "Instâncias", value: totalInstances, icon: Phone },
              { label: "Conectadas", value: totalConnected, icon: Wifi },
              { label: "Contatos", value: totalContacts, icon: MessageSquare },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border bg-card p-3 text-center">
                <s.icon className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                <p className="text-lg font-bold">{s.value}</p>
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>

          <Separator className="mb-4" />

          {/* Org list */}
          <ScrollArea className={orgs.length > 5 ? "max-h-[500px]" : ""}>
            <div className="space-y-3">
              {orgs.map((org) => (
                <div
                  key={org.id}
                  className={cn(
                    "rounded-lg border p-4 transition-colors",
                    org.is_active ? "bg-card" : "bg-muted/50 opacity-70"
                  )}
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Building2 className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{org.name}</p>
                        <p className="text-[10px] text-muted-foreground">{org.slug}</p>
                      </div>
                    </div>
                    <Badge variant={org.is_active ? "default" : "secondary"} className="shrink-0 text-[10px]">
                      {org.is_active ? "Ativa" : "Inativa"}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="rounded bg-muted/50 px-2 py-1.5">
                          <div className="flex items-center justify-center gap-1">
                            <Users className="h-3 w-3 text-muted-foreground" />
                            <span className="text-sm font-bold">{org.memberCount}</span>
                          </div>
                          <p className="text-[9px] text-muted-foreground">Usuários</p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>{org.memberCount} membros na organização</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="rounded bg-muted/50 px-2 py-1.5">
                          <div className="flex items-center justify-center gap-1">
                            {org.connectedInstances > 0 ? (
                              <Wifi className="h-3 w-3 text-primary" />
                            ) : (
                              <WifiOff className="h-3 w-3 text-destructive" />
                            )}
                            <span className="text-sm font-bold">
                              {org.connectedInstances}/{org.instanceCount}
                            </span>
                          </div>
                          <p className="text-[9px] text-muted-foreground">Instâncias</p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        {org.connectedInstances} de {org.instanceCount} instâncias conectadas
                      </TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="rounded bg-muted/50 px-2 py-1.5">
                          <div className="flex items-center justify-center gap-1">
                            <MessageSquare className="h-3 w-3 text-muted-foreground" />
                            <span className="text-sm font-bold">{org.contactCount}</span>
                          </div>
                          <p className="text-[9px] text-muted-foreground">Contatos</p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>{org.contactCount} contatos cadastrados</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="rounded bg-muted/50 px-2 py-1.5">
                          <div className="flex items-center justify-center gap-1">
                            <TrendingUp className="h-3 w-3 text-muted-foreground" />
                            <span className="text-sm font-bold">{org.conversationCount}</span>
                          </div>
                          <p className="text-[9px] text-muted-foreground">Conversas</p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>{org.conversationCount} conversas</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="rounded bg-muted/50 px-2 py-1.5 col-span-2 sm:col-span-1">
                          <div className="flex items-center justify-center gap-1">
                            <Activity className="h-3 w-3 text-muted-foreground" />
                            <span className="text-sm font-bold">{org.campaignCount}</span>
                          </div>
                          <p className="text-[9px] text-muted-foreground">Campanhas</p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>{org.campaignCount} campanhas criadas</TooltipContent>
                    </Tooltip>
                  </div>

                  {/* Instance health bar */}
                  {org.instanceCount > 0 && (
                    <div className="mt-2">
                      <Progress
                        value={(org.connectedInstances / org.instanceCount) * 100}
                        className="h-1.5"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminTenantDashboard;
