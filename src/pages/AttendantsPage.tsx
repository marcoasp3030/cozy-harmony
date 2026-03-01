import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  Users,
  Crown,
  Shield,
  Headphones,
  MessageSquare,
  Clock,
  CheckCircle2,
  TrendingUp,
  Trophy,
  UserPlus,
  MoreVertical,
  Trash2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

type AppRole = "admin" | "supervisor" | "atendente";

interface AttendantData {
  user_id: string;
  role: AppRole;
  profile: {
    name: string;
    email: string;
    avatar_url: string | null;
  };
  metrics: {
    active_conversations: number;
    resolved_conversations: number;
    avg_response_minutes: number;
    occurrences_handled: number;
  };
}

const ROLE_CONFIG: Record<AppRole, { label: string; icon: typeof Crown; color: string }> = {
  admin: { label: "Admin", icon: Crown, color: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  supervisor: { label: "Supervisor", icon: Shield, color: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  atendente: { label: "Atendente", icon: Headphones, color: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
};

const MAX_WORKLOAD = 15; // max conversations per attendant

const AttendantsPage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [selectedRole, setSelectedRole] = useState<AppRole>("atendente");
  const [removeTarget, setRemoveTarget] = useState<{ user_id: string; name: string } | null>(null);

  // Check if current user is admin
  const { data: currentUserRole } = useQuery({
    queryKey: ["my-role", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();
      return data?.role as AppRole | null;
    },
    enabled: !!user?.id,
  });

  const isAdmin = currentUserRole === "admin";
  const isSupervisorOrAdmin = currentUserRole === "admin" || currentUserRole === "supervisor";

  // Get all attendants with profiles
  const { data: attendants = [], isLoading } = useQuery({
    queryKey: ["attendants"],
    queryFn: async () => {
      // Get all user_roles
      const { data: roles, error: rolesErr } = await supabase
        .from("user_roles")
        .select("user_id, role");
      if (rolesErr) throw rolesErr;
      if (!roles?.length) return [];

      const userIds = roles.map((r: any) => r.user_id);

      // Get profiles
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, name, email, avatar_url")
        .in("user_id", userIds);

      // Get conversation metrics per assigned_to
      const { data: conversations } = await supabase
        .from("conversations")
        .select("assigned_to, status, last_message_at, created_at")
        .in("assigned_to", userIds);

      // Get occurrences created_by
      const { data: occurrences } = await supabase
        .from("occurrences")
        .select("created_by, status")
        .in("created_by", userIds);

      // Get messages for avg response time (outbound messages per user)
      const { data: messages } = await supabase
        .from("messages")
        .select("contact_id, created_at, direction")
        .eq("direction", "outbound")
        .order("created_at", { ascending: true })
        .limit(1000);

      const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));
      const convsByUser = new Map<string, any[]>();
      (conversations || []).forEach((c: any) => {
        if (!c.assigned_to) return;
        if (!convsByUser.has(c.assigned_to)) convsByUser.set(c.assigned_to, []);
        convsByUser.get(c.assigned_to)!.push(c);
      });

      const occByUser = new Map<string, any[]>();
      (occurrences || []).forEach((o: any) => {
        if (!o.created_by) return;
        if (!occByUser.has(o.created_by)) occByUser.set(o.created_by, []);
        occByUser.get(o.created_by)!.push(o);
      });

      return roles.map((r: any): AttendantData => {
        const profile = profileMap.get(r.user_id) || { name: "Sem nome", email: "", avatar_url: null };
        const userConvs = convsByUser.get(r.user_id) || [];
        const userOccs = occByUser.get(r.user_id) || [];

        const active = userConvs.filter((c: any) => c.status === "open").length;
        const resolved = userConvs.filter((c: any) => c.status === "resolved" || c.status === "closed").length;
        const occHandled = userOccs.length;

        // Estimate avg response (simplified — minutes between last_message_at timestamps)
        const responseTimes = userConvs
          .filter((c: any) => c.last_message_at && c.created_at)
          .map((c: any) => {
            const diff = new Date(c.last_message_at).getTime() - new Date(c.created_at).getTime();
            return diff / 60000;
          })
          .filter((m: number) => m > 0 && m < 1440);

        const avgResponse = responseTimes.length
          ? Math.round(responseTimes.reduce((a: number, b: number) => a + b, 0) / responseTimes.length)
          : 0;

        return {
          user_id: r.user_id,
          role: r.role as AppRole,
          profile: {
            name: profile.name,
            email: profile.email,
            avatar_url: profile.avatar_url,
          },
          metrics: {
            active_conversations: active,
            resolved_conversations: resolved,
            avg_response_minutes: avgResponse,
            occurrences_handled: occHandled,
          },
        };
      });
    },
  });

  // Profiles without a role (to add)
  const { data: availableProfiles = [] } = useQuery({
    queryKey: ["available-profiles", attendants],
    queryFn: async () => {
      const existingIds = attendants.map((a) => a.user_id);
      const { data } = await supabase.from("profiles").select("user_id, name, email");
      return (data || []).filter((p: any) => !existingIds.includes(p.user_id));
    },
    enabled: addOpen,
  });

  const addRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendants"] });
      toast.success("Atendente adicionado!");
      setAddOpen(false);
      setSelectedProfile("");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const changeRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      const { error } = await supabase
        .from("user_roles")
        .update({ role })
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendants"] });
      toast.success("Papel atualizado!");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const removeRoleMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendants"] });
      toast.success("Atendente removido!");
      setRemoveTarget(null);
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Ranking sorted by resolved conversations desc
  const ranked = [...attendants].sort(
    (a, b) => b.metrics.resolved_conversations - a.metrics.resolved_conversations
  );

  // Aggregate stats
  const totalActive = attendants.reduce((s, a) => s + a.metrics.active_conversations, 0);
  const totalResolved = attendants.reduce((s, a) => s + a.metrics.resolved_conversations, 0);
  const avgResponseAll = attendants.length
    ? Math.round(attendants.reduce((s, a) => s + a.metrics.avg_response_minutes, 0) / attendants.length)
    : 0;

  const formatMinutes = (m: number) => {
    if (m < 60) return `${m}min`;
    return `${Math.floor(m / 60)}h ${m % 60}min`;
  };

  const getInitials = (name: string) =>
    name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">Painel de Atendentes</h1>
          <p className="text-sm text-muted-foreground">
            Gestão de equipe, métricas e carga de trabalho
          </p>
        </div>
        {isAdmin && (
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button>
                <UserPlus className="mr-2 h-4 w-4" /> Adicionar Atendente
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Adicionar Atendente</DialogTitle>
                <DialogDescription>
                  Selecione um usuário e defina seu papel na equipe.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Usuário</label>
                  <Select value={selectedProfile} onValueChange={setSelectedProfile}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um usuário" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableProfiles.map((p: any) => (
                        <SelectItem key={p.user_id} value={p.user_id}>
                          {p.name} ({p.email})
                        </SelectItem>
                      ))}
                      {availableProfiles.length === 0 && (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          Nenhum usuário disponível
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Papel</label>
                  <Select value={selectedRole} onValueChange={(v) => setSelectedRole(v as AppRole)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="atendente">Atendente</SelectItem>
                      <SelectItem value="supervisor">Supervisor</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="w-full"
                  disabled={!selectedProfile}
                  onClick={() => addRoleMutation.mutate({ userId: selectedProfile, role: selectedRole })}
                >
                  Adicionar
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: "Atendentes", value: attendants.length, icon: Users, color: "text-primary" },
          { label: "Conversas Ativas", value: totalActive, icon: MessageSquare, color: "text-blue-500" },
          { label: "Resolvidas (total)", value: totalResolved, icon: CheckCircle2, color: "text-emerald-500" },
          { label: "Tempo Médio Resp.", value: formatMinutes(avgResponseAll), icon: Clock, color: "text-amber-500" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="flex items-center gap-3 p-4">
              <s.icon className={`h-8 w-8 ${s.color}`} />
              <div>
                <p className="font-heading text-2xl font-bold">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Ranking */}
      {ranked.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 font-heading text-lg">
              <Trophy className="h-5 w-5 text-amber-500" />
              Ranking de Desempenho
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {ranked.map((att, idx) => {
                const RoleIcon = ROLE_CONFIG[att.role].icon;
                const score =
                  att.metrics.resolved_conversations * 3 +
                  att.metrics.occurrences_handled * 2 -
                  att.metrics.active_conversations;

                return (
                  <div
                    key={att.user_id}
                    className="flex items-center gap-4 rounded-lg border p-3 transition-colors hover:bg-muted/50"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted font-heading text-sm font-bold">
                      {idx + 1}º
                    </span>
                    <Avatar className="h-9 w-9">
                      <AvatarImage src={att.profile.avatar_url || undefined} />
                      <AvatarFallback className="text-xs">
                        {getInitials(att.profile.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{att.profile.name}</p>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className={`text-[10px] ${ROLE_CONFIG[att.role].color}`}>
                          <RoleIcon className="mr-1 h-3 w-3" />
                          {ROLE_CONFIG[att.role].label}
                        </Badge>
                      </div>
                    </div>
                    <div className="hidden gap-6 text-center sm:flex">
                      <div>
                        <p className="text-sm font-bold">{att.metrics.resolved_conversations}</p>
                        <p className="text-[10px] text-muted-foreground">Resolvidas</p>
                      </div>
                      <div>
                        <p className="text-sm font-bold">{formatMinutes(att.metrics.avg_response_minutes)}</p>
                        <p className="text-[10px] text-muted-foreground">T. Médio</p>
                      </div>
                      <div>
                        <p className="text-sm font-bold">{att.metrics.occurrences_handled}</p>
                        <p className="text-[10px] text-muted-foreground">Ocorrências</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-bold text-primary">{score}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* Attendant Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {attendants.map((att) => {
          const RoleIcon = ROLE_CONFIG[att.role].icon;
          const workloadPct = Math.min(100, Math.round((att.metrics.active_conversations / MAX_WORKLOAD) * 100));
          const workloadColor =
            workloadPct >= 80 ? "text-destructive" : workloadPct >= 50 ? "text-amber-500" : "text-emerald-500";

          return (
            <Card key={att.user_id} className="relative overflow-hidden">
              {isAdmin && att.user_id !== user?.id && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="absolute right-2 top-2 h-8 w-8">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {(["admin", "supervisor", "atendente"] as AppRole[])
                      .filter((r) => r !== att.role)
                      .map((r) => (
                        <DropdownMenuItem
                          key={r}
                          onClick={() => changeRoleMutation.mutate({ userId: att.user_id, role: r })}
                        >
                          Alterar para {ROLE_CONFIG[r].label}
                        </DropdownMenuItem>
                      ))}
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => setRemoveTarget({ user_id: att.user_id, name: att.profile.name })}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Remover
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              <CardContent className="p-5">
                <div className="flex items-center gap-3">
                  <Avatar className="h-12 w-12">
                    <AvatarImage src={att.profile.avatar_url || undefined} />
                    <AvatarFallback>{getInitials(att.profile.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{att.profile.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{att.profile.email}</p>
                    <Badge variant="secondary" className={`mt-1 text-[10px] ${ROLE_CONFIG[att.role].color}`}>
                      <RoleIcon className="mr-1 h-3 w-3" />
                      {ROLE_CONFIG[att.role].label}
                    </Badge>
                  </div>
                </div>

                <Separator className="my-4" />

                <div className="grid grid-cols-2 gap-3 text-center">
                  <div>
                    <div className="flex items-center justify-center gap-1">
                      <MessageSquare className="h-3.5 w-3.5 text-blue-500" />
                      <span className="font-heading text-lg font-bold">{att.metrics.active_conversations}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">Ativas</p>
                  </div>
                  <div>
                    <div className="flex items-center justify-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      <span className="font-heading text-lg font-bold">{att.metrics.resolved_conversations}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">Resolvidas</p>
                  </div>
                  <div>
                    <div className="flex items-center justify-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-amber-500" />
                      <span className="font-heading text-lg font-bold">
                        {formatMinutes(att.metrics.avg_response_minutes)}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">T. Médio</p>
                  </div>
                  <div>
                    <div className="flex items-center justify-center gap-1">
                      <TrendingUp className="h-3.5 w-3.5 text-primary" />
                      <span className="font-heading text-lg font-bold">{att.metrics.occurrences_handled}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">Ocorrências</p>
                  </div>
                </div>

                <div className="mt-4 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Carga de trabalho</span>
                    <span className={`font-bold ${workloadColor}`}>{workloadPct}%</span>
                  </div>
                  <Progress value={workloadPct} className="h-2" />
                </div>
              </CardContent>
            </Card>
          );
        })}

        {attendants.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
            <Users className="mb-3 h-12 w-12 text-muted-foreground/50" />
            <p className="font-medium">Nenhum atendente cadastrado</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Adicione membros da equipe para começar a monitorar o desempenho.
            </p>
          </div>
        )}
      </div>

      {/* Remove Confirmation */}
      <AlertDialog open={!!removeTarget} onOpenChange={() => setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover atendente?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget?.name} será removido da equipe. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => removeTarget && removeRoleMutation.mutate(removeTarget.user_id)}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AttendantsPage;
