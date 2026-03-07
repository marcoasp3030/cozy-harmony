import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "sonner";
import {
  Building2,
  Plus,
  Users,
  Loader2,
  Pencil,
  Trash2,
  UserPlus,
  Crown,
  Eye,
  EyeOff,
  UserMinus,
  ShieldCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface OrgMember {
  user_id: string;
  role: string;
  profile_name: string;
  profile_email: string;
}

interface OrgData {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
  members: OrgMember[];
}

const roleLabels: Record<string, string> = {
  owner: "Proprietário",
  admin: "Admin",
  supervisor: "Supervisor",
  atendente: "Atendente",
};

const OrganizationManagement = () => {
  const { isAdmin } = useUserRole();
  const queryClient = useQueryClient();

  // Create org state
  const [createOpen, setCreateOpen] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Edit org state
  const [editOrg, setEditOrg] = useState<OrgData | null>(null);
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");

  // Delete org state
  const [deleteTarget, setDeleteTarget] = useState<OrgData | null>(null);

  // Add member state
  const [addMemberOrgId, setAddMemberOrgId] = useState<string | null>(null);
  const [addMemberMode, setAddMemberMode] = useState<"existing" | "new">("existing");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberName, setMemberName] = useState("");
  const [memberPassword, setMemberPassword] = useState("");
  const [memberRole, setMemberRole] = useState("admin");
  const [showMemberPassword, setShowMemberPassword] = useState(false);

  // Fetch all profiles for linking existing users
  const { data: allProfiles = [] } = useQuery({
    queryKey: ["all-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, name, email").order("name");
      return data || [];
    },
    enabled: isAdmin && !!addMemberOrgId,
  });

  // Filter out users already in the selected org
  const availableProfiles = allProfiles.filter((p) => {
    const org = organizations.find((o) => o.id === addMemberOrgId);
    return !org?.members.some((m) => m.user_id === p.user_id);
  });

  // Remove member state
  const [removeMember, setRemoveMember] = useState<{ orgId: string; member: OrgMember } | null>(null);

  // Edit member role state
  const [editMember, setEditMember] = useState<{ orgId: string; member: OrgMember } | null>(null);
  const [editMemberRole, setEditMemberRole] = useState("");

  const { data: organizations = [], isLoading } = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => {
      const { data: orgs, error } = await supabase
        .from("organizations")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;

      const result: OrgData[] = [];
      for (const org of orgs || []) {
        const { data: members } = await supabase
          .from("organization_members")
          .select("user_id, role")
          .eq("org_id", org.id);

        const userIds = (members || []).map((m: any) => m.user_id);
        let profiles: any[] = [];
        if (userIds.length > 0) {
          const { data: p } = await supabase
            .from("profiles")
            .select("user_id, name, email")
            .in("user_id", userIds);
          profiles = p || [];
        }

        const profileMap = new Map(profiles.map((p: any) => [p.user_id, p]));

        result.push({
          ...org,
          members: (members || []).map((m: any) => ({
            user_id: m.user_id,
            role: m.role,
            profile_name: profileMap.get(m.user_id)?.name || "—",
            profile_email: profileMap.get(m.user_id)?.email || "—",
          })),
        });
      }
      return result;
    },
    enabled: isAdmin,
  });

  const invalidateOrgs = () => queryClient.invalidateQueries({ queryKey: ["organizations"] });

  // CREATE ORG
  const createOrgMutation = useMutation({
    mutationFn: async () => {
      const { data: org, error: orgErr } = await supabase
        .from("organizations")
        .insert({ name: orgName.trim(), slug: orgSlug.trim().toLowerCase().replace(/\s+/g, "-") })
        .select()
        .single();
      if (orgErr) throw orgErr;

      const { data: userData, error: userErr } = await supabase.functions.invoke("create-admin", {
        body: { email: ownerEmail.trim(), password: ownerPassword, name: ownerName.trim() },
      });
      if (userErr) throw userErr;
      if (userData?.error) throw new Error(userData.error);

      const newUserId = userData?.user?.id;
      if (!newUserId) throw new Error("Erro ao criar usuário");

      await supabase.from("user_roles").insert({ user_id: newUserId, role: "admin" as any });

      const { error: memErr } = await supabase
        .from("organization_members")
        .insert({ org_id: org.id, user_id: newUserId, role: "owner" });
      if (memErr) throw memErr;

      return org;
    },
    onSuccess: () => {
      invalidateOrgs();
      toast.success("Empresa criada com sucesso!");
      setCreateOpen(false);
      setOrgName(""); setOrgSlug(""); setOwnerEmail(""); setOwnerName(""); setOwnerPassword("");
    },
    onError: (err: any) => toast.error(err.message || "Erro ao criar empresa"),
  });

  // EDIT ORG
  const editOrgMutation = useMutation({
    mutationFn: async () => {
      if (!editOrg) throw new Error("Nenhuma empresa selecionada");
      const { error } = await supabase
        .from("organizations")
        .update({ name: editName.trim(), slug: editSlug.trim(), updated_at: new Date().toISOString() })
        .eq("id", editOrg.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateOrgs();
      toast.success("Empresa atualizada!");
      setEditOrg(null);
    },
    onError: (err: any) => toast.error(err.message || "Erro ao editar empresa"),
  });

  // DELETE ORG
  const deleteOrgMutation = useMutation({
    mutationFn: async () => {
      if (!deleteTarget) throw new Error("Nenhuma empresa selecionada");
      // Remove members first
      await supabase.from("organization_members").delete().eq("org_id", deleteTarget.id);
      const { error } = await supabase.from("organizations").delete().eq("id", deleteTarget.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateOrgs();
      toast.success("Empresa removida!");
      setDeleteTarget(null);
    },
    onError: (err: any) => toast.error(err.message || "Erro ao remover empresa"),
  });

  // TOGGLE ORG ACTIVE
  const toggleOrgMutation = useMutation({
    mutationFn: async ({ orgId, isActive }: { orgId: string; isActive: boolean }) => {
      const { error } = await supabase
        .from("organizations")
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq("id", orgId);
      if (error) throw error;
    },
    onSuccess: () => { invalidateOrgs(); toast.success("Status atualizado!"); },
    onError: (err: any) => toast.error(err.message),
  });

  // ADD MEMBER
  const addMemberMutation = useMutation({
    mutationFn: async () => {
      if (!addMemberOrgId) throw new Error("Org não selecionada");

      let userId: string;

      if (addMemberMode === "existing") {
        if (!selectedUserId) throw new Error("Selecione um usuário");
        userId = selectedUserId;
      } else {
        const { data: userData, error: userErr } = await supabase.functions.invoke("create-admin", {
          body: { email: memberEmail.trim(), password: memberPassword, name: memberName.trim() },
        });
        if (userErr) throw userErr;
        if (userData?.error) throw new Error(userData.error);

        userId = userData?.user?.id;
        if (!userId) throw new Error("Erro ao criar usuário");

        const appRole = memberRole === "owner" || memberRole === "admin" ? "admin" : memberRole === "supervisor" ? "supervisor" : "atendente";
        await supabase.from("user_roles").insert({ user_id: userId, role: appRole as any });
      }

      const { error: memErr } = await supabase
        .from("organization_members")
        .insert({ org_id: addMemberOrgId, user_id: userId, role: memberRole });
      if (memErr) throw memErr;
    },
    onSuccess: () => {
      invalidateOrgs();
      queryClient.invalidateQueries({ queryKey: ["all-profiles"] });
      toast.success("Membro adicionado!");
      setAddMemberOrgId(null);
      setSelectedUserId(""); setMemberEmail(""); setMemberName(""); setMemberPassword(""); setMemberRole("admin"); setAddMemberMode("existing");
    },
    onError: (err: any) => toast.error(err.message || "Erro ao adicionar membro"),
  });

  // REMOVE MEMBER
  const removeMemberMutation = useMutation({
    mutationFn: async ({ orgId, userId }: { orgId: string; userId: string }) => {
      const { error } = await supabase
        .from("organization_members")
        .delete()
        .eq("org_id", orgId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateOrgs();
      toast.success("Membro removido da empresa!");
      setRemoveMember(null);
    },
    onError: (err: any) => toast.error(err.message || "Erro ao remover membro"),
  });

  // EDIT MEMBER ROLE
  const editMemberRoleMutation = useMutation({
    mutationFn: async () => {
      if (!editMember) throw new Error("Nenhum membro selecionado");
      const { error } = await supabase
        .from("organization_members")
        .update({ role: editMemberRole })
        .eq("org_id", editMember.orgId)
        .eq("user_id", editMember.member.user_id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateOrgs();
      toast.success("Papel atualizado!");
      setEditMember(null);
    },
    onError: (err: any) => toast.error(err.message || "Erro ao atualizar papel"),
  });

  const generateSlug = (name: string) => {
    setOrgName(name);
    setOrgSlug(name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""));
  };

  if (!isAdmin) return null;

  if (isLoading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 font-heading">
              <Building2 className="h-5 w-5" />
              Empresas
            </CardTitle>
            <CardDescription>Gerencie as empresas cadastradas na plataforma</CardDescription>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Nova Empresa
          </Button>
        </CardHeader>
        <CardContent>
          {organizations.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma empresa cadastrada. Crie a primeira empresa para começar.
            </p>
          ) : (
            <Accordion type="multiple" className="space-y-2">
              {organizations.map((org) => (
                <AccordionItem key={org.id} value={org.id} className="rounded-lg border px-4">
                  <AccordionTrigger className="hover:no-underline py-3">
                    <div className="flex items-center gap-3 flex-1 mr-3">
                      <Building2 className="h-5 w-5 shrink-0 text-primary" />
                      <div className="text-left min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{org.name}</span>
                          <Badge variant={org.is_active ? "default" : "secondary"} className="text-[10px]">
                            {org.is_active ? "Ativa" : "Inativa"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {org.slug} · {org.members.length} membro{org.members.length !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-3 pb-2">
                      {/* Org actions */}
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="text-sm font-medium flex items-center gap-1.5">
                          <Users className="h-4 w-4" /> Membros
                        </span>
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {org.is_active ? "Ativa" : "Inativa"}
                            </span>
                            <Switch
                              checked={org.is_active}
                              onCheckedChange={(checked) =>
                                toggleOrgMutation.mutate({ orgId: org.id, isActive: checked })
                              }
                            />
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditOrg(org);
                              setEditName(org.name);
                              setEditSlug(org.slug);
                            }}
                          >
                            <Pencil className="mr-1.5 h-3.5 w-3.5" />
                            Editar
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setAddMemberOrgId(org.id)}>
                            <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                            Adicionar
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setDeleteTarget(org)}
                          >
                            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                            Excluir
                          </Button>
                        </div>
                      </div>
                      {/* Members list */}
                      <div className="space-y-1.5">
                        {org.members.map((m) => (
                          <div
                            key={m.user_id}
                            className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                          >
                            <div className="min-w-0">
                              <p className="font-medium truncate flex items-center gap-1.5">
                                {m.role === "owner" && <Crown className="h-3.5 w-3.5 text-amber-500" />}
                                {m.profile_name}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">{m.profile_email}</p>
                            </div>
                            <div className="flex items-center gap-2 ml-2 shrink-0">
                              <Badge variant="outline" className="text-[10px]">
                                {roleLabels[m.role] || m.role}
                              </Badge>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                title="Alterar papel"
                                onClick={() => {
                                  setEditMember({ orgId: org.id, member: m });
                                  setEditMemberRole(m.role);
                                }}
                              >
                                <ShieldCheck className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                title="Remover membro"
                                onClick={() => setRemoveMember({ orgId: org.id, member: m })}
                              >
                                <UserMinus className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        ))}
                        {org.members.length === 0 && (
                          <p className="text-xs text-muted-foreground text-center py-2">
                            Nenhum membro adicionado
                          </p>
                        )}
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardContent>
      </Card>

      {/* Create org dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nova Empresa</DialogTitle>
            <DialogDescription>Crie uma empresa e seu usuário proprietário.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Nome da Empresa *</Label>
              <Input placeholder="Minha Empresa" value={orgName} onChange={(e) => generateSlug(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Slug *</Label>
              <Input placeholder="minha-empresa" value={orgSlug} onChange={(e) => setOrgSlug(e.target.value)} />
            </div>
            <div className="border-t pt-4">
              <p className="text-sm font-medium mb-3">Usuário Proprietário</p>
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Nome *</Label>
                  <Input placeholder="Nome completo" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Email *</Label>
                  <Input type="email" placeholder="proprietario@empresa.com" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Senha *</Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="Mínimo 6 caracteres"
                      value={ownerPassword}
                      onChange={(e) => setOwnerPassword(e.target.value)}
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
              </div>
            </div>
            <Button
              className="w-full"
              disabled={!orgName.trim() || !orgSlug.trim() || !ownerName.trim() || !ownerEmail.trim() || ownerPassword.length < 6 || createOrgMutation.isPending}
              onClick={() => createOrgMutation.mutate()}
            >
              {createOrgMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar Empresa
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit org dialog */}
      <Dialog open={!!editOrg} onOpenChange={(open) => !open && setEditOrg(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Empresa</DialogTitle>
            <DialogDescription>Altere o nome ou slug da empresa.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Slug *</Label>
              <Input value={editSlug} onChange={(e) => setEditSlug(e.target.value)} />
            </div>
            <Button
              className="w-full"
              disabled={!editName.trim() || !editSlug.trim() || editOrgMutation.isPending}
              onClick={() => editOrgMutation.mutate()}
            >
              {editOrgMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add member dialog */}
      <Dialog open={!!addMemberOrgId} onOpenChange={(open) => !open && setAddMemberOrgId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar Membro</DialogTitle>
            <DialogDescription>Crie um novo usuário e adicione-o a esta empresa.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input placeholder="Nome completo" value={memberName} onChange={(e) => setMemberName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email *</Label>
              <Input type="email" placeholder="usuario@empresa.com" value={memberEmail} onChange={(e) => setMemberEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Senha *</Label>
              <div className="relative">
                <Input
                  type={showMemberPassword ? "text" : "password"}
                  placeholder="Mínimo 6 caracteres"
                  value={memberPassword}
                  onChange={(e) => setMemberPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowMemberPassword(!showMemberPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showMemberPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Papel na empresa</Label>
              <Select value={memberRole} onValueChange={setMemberRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="supervisor">Supervisor</SelectItem>
                  <SelectItem value="atendente">Atendente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full"
              disabled={!memberName.trim() || !memberEmail.trim() || memberPassword.length < 6 || addMemberMutation.isPending}
              onClick={() => addMemberMutation.mutate()}
            >
              {addMemberMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Adicionar Membro
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit member role dialog */}
      <Dialog open={!!editMember} onOpenChange={(open) => !open && setEditMember(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Alterar Papel</DialogTitle>
            <DialogDescription>
              Altere o papel de <strong>{editMember?.member.profile_name}</strong> na empresa.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <Select value={editMemberRole} onValueChange={setEditMemberRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="owner">Proprietário</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="supervisor">Supervisor</SelectItem>
                <SelectItem value="atendente">Atendente</SelectItem>
              </SelectContent>
            </Select>
            <Button
              className="w-full"
              disabled={editMemberRoleMutation.isPending}
              onClick={() => editMemberRoleMutation.mutate()}
            >
              {editMemberRoleMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Remove member confirm */}
      <AlertDialog open={!!removeMember} onOpenChange={(open) => !open && setRemoveMember(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover membro?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{removeMember?.member.profile_name}</strong> ({removeMember?.member.profile_email}) será removido desta empresa. O usuário continuará existindo no sistema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!removeMember) return;
                removeMemberMutation.mutate({
                  orgId: removeMember.orgId,
                  userId: removeMember.member.user_id,
                });
              }}
            >
              {removeMemberMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete org confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir empresa?</AlertDialogTitle>
            <AlertDialogDescription>
              A empresa <strong>{deleteTarget?.name}</strong> e todos os seus vínculos de membros serão removidos permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteOrgMutation.mutate()}
            >
              {deleteOrgMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default OrganizationManagement;
