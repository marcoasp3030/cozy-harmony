import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole, type AppRole } from "@/hooks/useUserRole";
import { toast } from "sonner";
import {
  Crown,
  Shield,
  Headphones,
  UserPlus,
  MoreVertical,
  Trash2,
  Loader2,
  Mail,
  Eye,
  EyeOff,
  Pencil,
  KeyRound,
  MonitorSmartphone,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
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
  DropdownMenuSeparator,
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

const ROLE_CONFIG: Record<AppRole, { label: string; icon: typeof Crown; color: string }> = {
  admin: { label: "Admin", icon: Crown, color: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  supervisor: { label: "Supervisor", icon: Shield, color: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  atendente: { label: "Atendente", icon: Headphones, color: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
};

interface UserData {
  user_id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  role: AppRole | null;
  created_at: string;
  supervisor_user_id?: string | null;
}

interface InstanceOption {
  id: string;
  name: string;
}

const UserManagement = () => {
  const { user } = useAuth();
  const { isAdmin, isSupervisor, role: currentRole } = useUserRole();
  const queryClient = useQueryClient();

  const canManage = isAdmin || isSupervisor;

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<AppRole>("atendente");
  const [showPassword, setShowPassword] = useState(false);
  const [selectedInstances, setSelectedInstances] = useState<string[]>([]);
  const [removeTarget, setRemoveTarget] = useState<UserData | null>(null);
  const [editTarget, setEditTarget] = useState<UserData | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [resetTarget, setResetTarget] = useState<UserData | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [instancesDialogTarget, setInstancesDialogTarget] = useState<UserData | null>(null);
  const [editInstances, setEditInstances] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<UserData | null>(null);

  // Load supervisor's instances for assignment
  const { data: myInstances = [] } = useQuery({
    queryKey: ["my-instances", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data } = await supabase
        .from("whatsapp_instances")
        .select("id, name")
        .eq("user_id", user.id)
        .order("created_at");
      return (data || []) as InstanceOption[];
    },
    enabled: !!user?.id && (isSupervisor || isAdmin),
  });

  // Load users
  const { data: users = [], isLoading } = useQuery({
    queryKey: ["all-users", currentRole],
    queryFn: async () => {
      if (!user?.id) return [];

      // If supervisor, only load their own attendants
      if (isSupervisor && !isAdmin) {
        const { data: links } = await supabase
          .from("attendant_supervisors")
          .select("attendant_user_id")
          .eq("supervisor_user_id", user.id);

        const attendantIds = (links || []).map((l: any) => l.attendant_user_id);
        if (attendantIds.length === 0) return [];

        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, name, email, avatar_url, created_at")
          .in("user_id", attendantIds);

        const { data: roles } = await supabase
          .from("user_roles")
          .select("user_id, role")
          .in("user_id", attendantIds);

        const roleMap = new Map((roles || []).map((r: any) => [r.user_id, r.role]));

        return (profiles || []).map((p): UserData => ({
          user_id: p.user_id,
          name: p.name,
          email: p.email,
          avatar_url: p.avatar_url,
          role: (roleMap.get(p.user_id) as AppRole) ?? null,
          created_at: p.created_at,
          supervisor_user_id: user.id,
        }));
      }

      // Admin: load all
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("user_id, name, email, avatar_url, created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;

      const userIds = (profiles || []).map((p) => p.user_id);
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", userIds);

      const { data: supervisorLinks } = await supabase
        .from("attendant_supervisors")
        .select("attendant_user_id, supervisor_user_id")
        .in("attendant_user_id", userIds);

      const roleMap = new Map((roles || []).map((r: any) => [r.user_id, r.role]));
      const supervisorMap = new Map((supervisorLinks || []).map((l: any) => [l.attendant_user_id, l.supervisor_user_id]));

      return (profiles || []).map((p): UserData => ({
        user_id: p.user_id,
        name: p.name,
        email: p.email,
        avatar_url: p.avatar_url,
        role: (roleMap.get(p.user_id) as AppRole) ?? null,
        created_at: p.created_at,
        supervisor_user_id: supervisorMap.get(p.user_id) || null,
      }));
    },
    enabled: !!user?.id && canManage,
  });

  const createUserMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("create-admin", {
        body: { email: newEmail.trim(), password: newPassword, name: newName.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const newUserId = data?.user?.id;
      if (!newUserId) throw new Error("Erro ao obter ID do novo usuário");

      // Assign role
      const roleToAssign = isSupervisor && !isAdmin ? "atendente" : newRole;
      const { error: roleErr } = await supabase
        .from("user_roles")
        .insert({ user_id: newUserId, role: roleToAssign });
      if (roleErr) throw roleErr;

      // If supervisor creating attendant, link hierarchy
      if (isSupervisor || (isAdmin && roleToAssign === "atendente")) {
        const supervisorId = user!.id;
        await supabase
          .from("attendant_supervisors")
          .insert({ attendant_user_id: newUserId, supervisor_user_id: supervisorId });

        // Assign selected instances
        if (selectedInstances.length > 0) {
          const rows = selectedInstances.map((instanceId) => ({
            attendant_user_id: newUserId,
            instance_id: instanceId,
          }));
          await supabase.from("attendant_instances").insert(rows);
        }
      }

      return newUserId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-users"] });
      toast.success("Usuário criado com sucesso!");
      setCreateOpen(false);
      setNewName("");
      setNewEmail("");
      setNewPassword("");
      setNewRole("atendente");
      setSelectedInstances([]);
    },
    onError: (err: any) => toast.error(err.message || "Erro ao criar usuário"),
  });

  const changeRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      const { data: existing } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from("user_roles")
          .update({ role })
          .eq("user_id", userId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("user_roles")
          .insert({ user_id: userId, role });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-users"] });
      queryClient.invalidateQueries({ queryKey: ["user-role"] });
      toast.success("Papel atualizado!");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const removeRoleMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", userId);
      if (error) throw error;
      // Also remove supervisor link
      await supabase.from("attendant_supervisors").delete().eq("attendant_user_id", userId);
      await supabase.from("attendant_instances").delete().eq("attendant_user_id", userId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-users"] });
      toast.success("Papel removido!");
      setRemoveTarget(null);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const editProfileMutation = useMutation({
    mutationFn: async ({ userId, name, email }: { userId: string; name: string; email: string }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ name: name.trim(), email: email.trim() })
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-users"] });
      toast.success("Dados atualizados!");
      setEditTarget(null);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ userId, password }: { userId: string; password: string }) => {
      const { data, error } = await supabase.functions.invoke("reset-password-admin", {
        body: { user_id: userId, new_password: password },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      toast.success("Senha alterada com sucesso!");
      setResetTarget(null);
      setResetPassword("");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const updateInstancesMutation = useMutation({
    mutationFn: async ({ userId, instanceIds }: { userId: string; instanceIds: string[] }) => {
      // Delete existing
      await supabase.from("attendant_instances").delete().eq("attendant_user_id", userId);
      // Insert new
      if (instanceIds.length > 0) {
        const rows = instanceIds.map((instanceId) => ({
          attendant_user_id: userId,
          instance_id: instanceId,
        }));
        const { error } = await supabase.from("attendant_instances").insert(rows);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Instâncias atualizadas!");
      setInstancesDialogTarget(null);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const openEditDialog = (u: UserData) => {
    setEditTarget(u);
    setEditName(u.name);
    setEditEmail(u.email);
  };

  const openResetDialog = (u: UserData) => {
    setResetTarget(u);
    setResetPassword("");
    setShowResetPassword(false);
  };

  const openInstancesDialog = async (u: UserData) => {
    setInstancesDialogTarget(u);
    // Load current assignments
    const { data } = await supabase
      .from("attendant_instances")
      .select("instance_id")
      .eq("attendant_user_id", u.user_id);
    setEditInstances((data || []).map((d: any) => d.instance_id));
  };

  const toggleInstance = (instanceId: string) => {
    setSelectedInstances((prev) =>
      prev.includes(instanceId) ? prev.filter((id) => id !== instanceId) : [...prev, instanceId]
    );
  };

  const toggleEditInstance = (instanceId: string) => {
    setEditInstances((prev) =>
      prev.includes(instanceId) ? prev.filter((id) => id !== instanceId) : [...prev, instanceId]
    );
  };

  const getInitials = (name: string) =>
    name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  if (!canManage) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Shield className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">
            Apenas administradores e supervisores podem gerenciar usuários.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const showRoleToAssign = newRole === "atendente" || isSupervisor;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="font-heading">
              {isSupervisor && !isAdmin ? "Meus Atendentes" : "Usuários"}
            </CardTitle>
            <CardDescription>
              {isSupervisor && !isAdmin
                ? "Gerencie os atendentes da sua equipe e suas instâncias"
                : "Gerencie os usuários do sistema e seus papéis"}
            </CardDescription>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <UserPlus className="mr-2 h-4 w-4" />
                {isSupervisor && !isAdmin ? "Novo Atendente" : "Novo Usuário"}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {isSupervisor && !isAdmin ? "Criar Novo Atendente" : "Criar Novo Usuário"}
                </DialogTitle>
                <DialogDescription>
                  O usuário será criado com email já confirmado.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label>Nome *</Label>
                  <Input
                    placeholder="Nome completo"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email *</Label>
                  <Input
                    type="email"
                    placeholder="usuario@email.com"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Senha *</Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="Mínimo 6 caracteres"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      minLength={6}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Role selector - only for admins */}
                {isAdmin && (
                  <div className="space-y-2">
                    <Label>Papel</Label>
                    <Select value={newRole} onValueChange={(v) => setNewRole(v as AppRole)}>
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
                )}

                {/* Instance assignment - when creating atendente */}
                {(isSupervisor || (isAdmin && newRole === "atendente")) && myInstances.length > 0 && (
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5">
                      <MonitorSmartphone className="h-4 w-4" />
                      Instâncias com acesso
                    </Label>
                    <div className="space-y-2 rounded-lg border p-3 max-h-40 overflow-y-auto">
                      {myInstances.map((inst) => (
                        <label key={inst.id} className="flex items-center gap-2 cursor-pointer text-sm">
                          <Checkbox
                            checked={selectedInstances.includes(inst.id)}
                            onCheckedChange={() => toggleInstance(inst.id)}
                          />
                          {inst.name}
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Selecione quais instâncias o atendente poderá visualizar
                    </p>
                  </div>
                )}

                <Button
                  className="w-full"
                  disabled={!newName.trim() || !newEmail.trim() || newPassword.length < 6 || createUserMutation.isPending}
                  onClick={() => createUserMutation.mutate()}
                >
                  {createUserMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {isSupervisor && !isAdmin ? "Criar Atendente" : "Criar Usuário"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {users.map((u) => {
              const roleConfig = u.role ? ROLE_CONFIG[u.role] : null;
              const RoleIcon = roleConfig?.icon;
              const isSelf = u.user_id === user?.id;

              return (
                <div
                  key={u.user_id}
                  className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
                >
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={u.avatar_url || undefined} />
                    <AvatarFallback className="text-xs bg-primary/10 text-primary">
                      {getInitials(u.name)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{u.name}</p>
                      {isSelf && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          Você
                        </Badge>
                      )}
                    </div>
                    <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      <Mail className="h-3 w-3" /> {u.email}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {u.role && roleConfig && RoleIcon ? (
                      <Badge variant="secondary" className={`text-[10px] ${roleConfig.color}`}>
                        <RoleIcon className="mr-1 h-3 w-3" />
                        {roleConfig.label}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        Sem papel
                      </Badge>
                    )}

                    {!isSelf && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditDialog(u)}>
                            <Pencil className="mr-2 h-4 w-4" /> Editar dados
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openResetDialog(u)}>
                            <KeyRound className="mr-2 h-4 w-4" /> Resetar senha
                          </DropdownMenuItem>

                          {/* Instance visibility - for attendants */}
                          {u.role === "atendente" && (
                            <DropdownMenuItem onClick={() => openInstancesDialog(u)}>
                              <MonitorSmartphone className="mr-2 h-4 w-4" /> Instâncias
                            </DropdownMenuItem>
                          )}

                          {isAdmin && (
                            <>
                              <DropdownMenuSeparator />
                              {(["admin", "supervisor", "atendente"] as AppRole[]).map((role) => (
                                <DropdownMenuItem
                                  key={role}
                                  onClick={() => changeRoleMutation.mutate({ userId: u.user_id, role })}
                                  disabled={u.role === role}
                                >
                                  {ROLE_CONFIG[role].label}
                                  {u.role === role && " ✓"}
                                </DropdownMenuItem>
                              ))}
                              {u.role && (
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => setRemoveTarget(u)}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" /> Remover papel
                                </DropdownMenuItem>
                              )}
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              );
            })}

            {users.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {isSupervisor && !isAdmin
                  ? "Nenhum atendente cadastrado. Crie um novo atendente para começar."
                  : "Nenhum usuário encontrado."}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Remove role confirmation */}
      <AlertDialog open={!!removeTarget} onOpenChange={() => setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover papel</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover o papel de <strong>{removeTarget?.name}</strong>?
              O usuário continuará existindo mas perderá suas permissões.
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

      {/* Edit user dialog */}
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Usuário</DialogTitle>
            <DialogDescription>
              Altere o nome e email de {editTarget?.name}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input
                placeholder="Nome completo"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label>Email *</Label>
              <Input
                type="email"
                placeholder="usuario@email.com"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                maxLength={255}
              />
            </div>
            <Button
              className="w-full"
              disabled={!editName.trim() || !editEmail.trim() || editProfileMutation.isPending}
              onClick={() =>
                editTarget &&
                editProfileMutation.mutate({
                  userId: editTarget.user_id,
                  name: editName,
                  email: editEmail,
                })
              }
            >
              {editProfileMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar Alterações
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reset password dialog */}
      <Dialog open={!!resetTarget} onOpenChange={(open) => !open && setResetTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Resetar Senha</DialogTitle>
            <DialogDescription>
              Defina uma nova senha para <strong>{resetTarget?.name}</strong> ({resetTarget?.email}).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Nova Senha *</Label>
              <div className="relative">
                <Input
                  type={showResetPassword ? "text" : "password"}
                  placeholder="Mínimo 6 caracteres"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  minLength={6}
                  maxLength={72}
                />
                <button
                  type="button"
                  onClick={() => setShowResetPassword(!showResetPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showResetPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button
              className="w-full"
              disabled={resetPassword.length < 6 || resetPasswordMutation.isPending}
              onClick={() =>
                resetTarget &&
                resetPasswordMutation.mutate({
                  userId: resetTarget.user_id,
                  password: resetPassword,
                })
              }
            >
              {resetPasswordMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Alterar Senha
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manage instances dialog */}
      <Dialog open={!!instancesDialogTarget} onOpenChange={(open) => !open && setInstancesDialogTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Instâncias de {instancesDialogTarget?.name}</DialogTitle>
            <DialogDescription>
              Selecione quais instâncias este atendente pode visualizar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {myInstances.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhuma instância disponível.
              </p>
            ) : (
              <div className="space-y-2 rounded-lg border p-3 max-h-60 overflow-y-auto">
                {myInstances.map((inst) => (
                  <label key={inst.id} className="flex items-center gap-2 cursor-pointer text-sm">
                    <Checkbox
                      checked={editInstances.includes(inst.id)}
                      onCheckedChange={() => toggleEditInstance(inst.id)}
                    />
                    {inst.name}
                  </label>
                ))}
              </div>
            )}
            <Button
              className="w-full"
              disabled={updateInstancesMutation.isPending}
              onClick={() =>
                instancesDialogTarget &&
                updateInstancesMutation.mutate({
                  userId: instancesDialogTarget.user_id,
                  instanceIds: editInstances,
                })
              }
            >
              {updateInstancesMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar Instâncias
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserManagement;
