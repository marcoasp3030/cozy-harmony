import { useState, useEffect, useRef } from "react";
import {
  Plus, Trash2, Star, Loader2, QrCode, Wifi, WifiOff,
  CheckCircle2, RefreshCw, Smartphone, Clock, Unplug, Pencil, Zap,
  Users, Copy, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useWhatsAppInstances, type WhatsAppInstance } from "@/hooks/useWhatsAppInstances";
import { useAuth } from "@/hooks/useAuth";

const extractError = (data: any, fallback: string): string => {
  if (!data) return fallback;
  const detail = data.details ? (typeof data.details === "string" ? data.details : JSON.stringify(data.details, null, 2)) : "";
  const debug = data.debug ? (typeof data.debug === "string" ? data.debug : JSON.stringify(data.debug, null, 2)) : "";
  const mainError = data.error || data.message || "";
  const extra = detail || debug;
  return extra ? `${mainError}\n\nDetalhes: ${extra}` : mainError || fallback;
};

interface LinkedAutomation {
  id: string;
  name: string;
  is_active: boolean | null;
}

interface InstanceCardProps {
  instance: WhatsAppInstance;
  automations: LinkedAutomation[];
  onUpdate: () => void;
  onSetDefault: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => Promise<void>;
}

const InstanceCard = ({ instance, automations, onUpdate, onSetDefault, onDelete, onRename }: InstanceCardProps) => {
  const [checking, setChecking] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "checking" | "connected" | "disconnected" | "error">(
    instance.status === "connected" ? "connected" : "idle"
  );
  const [connectionInfo, setConnectionInfo] = useState<{ phone?: string; name?: string } | null>(
    instance.phone ? { phone: instance.phone, name: instance.device_name || undefined } : null
  );
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loadingQr, setLoadingQr] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(instance.name);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [groups, setGroups] = useState<{ id: string; name: string; participants: number }[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Poll status every 5s while QR is visible
  useEffect(() => {
    if (!qrCode) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }
    pollingRef.current = setInterval(async () => {
      try {
        const { data } = await supabase.functions.invoke("uazapi-instance", {
          body: { action: "test", instanceId: instance.id },
        });
        if (data?.connected) {
          setConnectionStatus("connected");
          const phone = data.phone || data.instance?.user?.id?.replace("@s.whatsapp.net", "") || undefined;
          const name = data.name || data.instance?.user?.name || data.pushname || undefined;
          setConnectionInfo({ phone, name });
          setQrCode(null);
          setLastChecked(new Date());
          await supabase.from("whatsapp_instances").update({ status: "connected", phone: phone || null, device_name: name || null } as any).eq("id", instance.id);
          onUpdate();
          toast.success("WhatsApp conectado com sucesso!");
        }
      } catch {}
    }, 5000);
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [qrCode, instance.id, onUpdate]);

  const checkStatus = async () => {
    setChecking(true);
    setConnectionStatus("checking");
    try {
      const { data, error } = await supabase.functions.invoke("uazapi-instance", {
        body: { action: "test", instanceId: instance.id },
      });
      if (error) throw error;
      if (data.connected) {
        setConnectionStatus("connected");
        const phone = data.phone || data.instance?.user?.id?.replace("@s.whatsapp.net", "") || undefined;
        const name = data.name || data.instance?.user?.name || data.pushname || undefined;
        setConnectionInfo({ phone, name });
        await supabase.from("whatsapp_instances").update({ status: "connected", phone: phone || null, device_name: name || null } as any).eq("id", instance.id);
      } else {
        setConnectionStatus("disconnected");
        setConnectionInfo(null);
        await supabase.from("whatsapp_instances").update({ status: "disconnected" } as any).eq("id", instance.id);
      }
    } catch {
      setConnectionStatus("error");
      setConnectionInfo(null);
    }
    setLastChecked(new Date());
    setChecking(false);
    onUpdate();
  };

  const connectQr = async () => {
    setLoadingQr(true);
    setQrCode(null);
    try {
      // If no instance token, try to create instance first
      if (!instance.instance_token) {
        toast.info("Criando instância na UazAPI...");
        const { data: createData, error: createError } = await supabase.functions.invoke("uazapi-instance", {
          body: { action: "create-instance", instanceId: instance.id, instanceName: instance.instance_name || instance.name },
        });
        if (createError) throw createError;
        if (createData?.instanceToken) {
          await supabase.from("whatsapp_instances").update({
            instance_token: createData.instanceToken,
            instance_name: createData.instanceName || instance.instance_name || instance.name,
          } as any).eq("id", instance.id);
          onUpdate();
          toast.success("Instância criada! Gerando QR Code...");
        } else if (createData?.error) {
          toast.error(extractError(createData, "Erro ao criar instância"), { duration: 8000 });
          setLoadingQr(false);
          return;
        }
      }

      const { data, error } = await supabase.functions.invoke("uazapi-instance", {
        body: { action: "connect", instanceId: instance.id },
      });
      if (error) throw error;
      if (data.qrcode) {
        setQrCode(data.qrcode);
        toast.success("QR Code gerado! Escaneie com seu WhatsApp.");
      } else if (data.error) {
        toast.error(extractError(data, "Erro ao gerar QR"), { duration: 8000 });
      } else {
        toast.info("Instância já conectada ou QR não disponível.");
      }
    } catch (err: any) {
      toast.error("Erro ao gerar QR: " + (err.message || "Tente novamente"));
    }
    setLoadingQr(false);
  };

  const disconnect = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("uazapi-instance", {
        body: { action: "disconnect", instanceId: instance.id },
      });
      if (error) throw error;
      if (data.error) {
        toast.error(extractError(data, "Erro ao desconectar"));
        return;
      }
      setQrCode(null);
      setConnectionStatus("disconnected");
      setConnectionInfo(null);
      await supabase.from("whatsapp_instances").update({ status: "disconnected" } as any).eq("id", instance.id);
      toast.success("Desconectado com sucesso.");
      onUpdate();
    } catch (err: any) {
      toast.error("Erro: " + (err.message || "Tente novamente"));
    }
  };

  const loadGroups = async () => {
    if (showGroups && groups.length > 0) {
      setShowGroups(false);
      return;
    }
    setLoadingGroups(true);
    setShowGroups(true);
    try {
      const { data, error } = await supabase.functions.invoke("uazapi-instance", {
        body: { action: "list-groups", instanceId: instance.id },
      });
      if (error) throw error;
      if (data?.groups) {
        setGroups(data.groups);
        if (data.groups.length === 0) toast.info("Nenhum grupo encontrado nesta instância.");
      } else {
        toast.error(extractError(data, "Erro ao listar grupos"));
      }
    } catch (err: any) {
      toast.error("Erro ao listar grupos: " + (err.message || "Tente novamente"));
    }
    setLoadingGroups(false);
  };

  const copyJid = (jid: string) => {
    navigator.clipboard.writeText(jid);
    setCopiedId(jid);
    toast.success("JID copiado!");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const statusColor = connectionStatus === "connected" ? "border-emerald-500/30" :
    connectionStatus === "disconnected" || connectionStatus === "error" ? "border-destructive/30" : "border-border";

  return (
    <Card className={`border-2 ${statusColor}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            {editing ? (
              <div className="flex items-center gap-1">
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="h-7 text-sm w-40"
                  autoFocus
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && editName.trim()) {
                      await onRename(instance.id, editName.trim());
                      setEditing(false);
                    }
                    if (e.key === "Escape") {
                      setEditName(instance.name);
                      setEditing(false);
                    }
                  }}
                  onBlur={async () => {
                    if (editName.trim() && editName.trim() !== instance.name) {
                      await onRename(instance.id, editName.trim());
                    } else {
                      setEditName(instance.name);
                    }
                    setEditing(false);
                  }}
                />
              </div>
            ) : (
              <CardTitle className="text-base font-heading cursor-pointer" onClick={() => setEditing(true)} title="Clique para editar">
                {instance.name}
              </CardTitle>
            )}
            {!editing && (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditing(true)} title="Editar nome">
                <Pencil className="h-3 w-3" />
              </Button>
            )}
            {instance.is_default && (
              <Badge variant="secondary" className="text-[10px] gap-1">
                <Star className="h-3 w-3 fill-current" /> Padrão
              </Badge>
            )}
            {connectionStatus === "connected" ? (
              <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px]">
                <Wifi className="h-3 w-3 mr-1" /> Conectado
              </Badge>
            ) : connectionStatus === "disconnected" || connectionStatus === "error" ? (
              <Badge variant="destructive" className="text-[10px]">
                <WifiOff className="h-3 w-3 mr-1" /> Desconectado
              </Badge>
            ) : null}
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={checkStatus} disabled={checking}>
              {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
            {!instance.is_default && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onSetDefault(instance.id)} title="Definir como padrão">
                <Star className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDelete(instance.id)} title="Remover">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {connectionStatus === "connected" && connectionInfo && (
          <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/15 p-3 flex items-center gap-3">
            <Smartphone className="h-5 w-5 text-emerald-500" />
            <div>
              {connectionInfo.name && <p className="text-sm font-medium">{connectionInfo.name}</p>}
              {connectionInfo.phone && <p className="text-xs text-muted-foreground">📱 {connectionInfo.phone}</p>}
            </div>
          </div>
        )}

        <div className="text-xs text-muted-foreground space-y-0.5">
          {instance.instance_name && <p>Instância: {instance.instance_name}</p>}
        </div>

        {lastChecked && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            Verificado: {lastChecked.toLocaleTimeString("pt-BR")}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={connectQr} disabled={loadingQr}>
            {loadingQr ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <QrCode className="mr-1 h-3 w-3" />}
            QR Code
          </Button>
          {connectionStatus === "connected" && (
            <>
              <Button size="sm" variant="destructive" onClick={disconnect}>
                <Unplug className="mr-1 h-3 w-3" /> Desconectar
              </Button>
              <Button size="sm" variant="outline" onClick={loadGroups} disabled={loadingGroups}>
                {loadingGroups ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Users className="mr-1 h-3 w-3" />}
                Grupos
              </Button>
            </>
          )}
        </div>

        {/* Groups list */}
        {showGroups && (
          <div className="rounded-lg border bg-muted/30 p-2.5 space-y-2">
            <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
              <Users className="h-3 w-3" /> Grupos ({groups.length})
            </p>
            {loadingGroups && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loadingGroups && groups.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">Nenhum grupo encontrado.</p>
            )}
            {groups.map((group) => (
              <div key={group.id} className="flex items-center gap-2 rounded-md border bg-card p-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{group.name}</p>
                  <p className="text-[10px] text-muted-foreground font-mono truncate">{group.id}</p>
                  {group.participants > 0 && (
                    <p className="text-[10px] text-muted-foreground">{group.participants} participantes</p>
                  )}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0"
                  onClick={() => copyJid(group.id)}
                  title="Copiar JID"
                >
                  {copiedId === group.id ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Linked automations */}
        {automations.length > 0 && (
          <div className="rounded-lg border bg-muted/30 p-2.5 space-y-1.5">
            <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
              <Zap className="h-3 w-3" /> Automações vinculadas ({automations.length})
            </p>
            {automations.map((auto) => (
              <div key={auto.id} className="flex items-center gap-2 text-xs">
                <span className={`h-1.5 w-1.5 rounded-full ${auto.is_active ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                <span className="truncate">{auto.name}</span>
                <Badge variant="outline" className="text-[9px] ml-auto">
                  {auto.is_active ? "Ativo" : "Inativo"}
                </Badge>
              </div>
            ))}
          </div>
        )}

        {qrCode && (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-4">
            <p className="text-sm font-medium">Escaneie o QR Code</p>
            <div className="rounded-lg bg-white p-3">
              <img
                src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`}
                alt="QR Code WhatsApp"
                className="h-48 w-48"
              />
            </div>
            <p className="text-xs text-muted-foreground">WhatsApp → Dispositivos conectados → Conectar</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default function InstanceManager() {
  const { user } = useAuth();
  const { instances, loading, load, addInstance, updateInstance, deleteInstance, setDefault } = useWhatsAppInstances();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [linkedAutomations, setLinkedAutomations] = useState<LinkedAutomation[]>([]);

  useEffect(() => {
    supabase.from("automations").select("id, name, is_active, instance_id").then(({ data }) => {
      if (data) setLinkedAutomations(data as any);
    });
  }, []);

  const handleAdd = async () => {
    if (!newName.trim()) {
      toast.error("Nome da instância é obrigatório.");
      return;
    }
    if (!user) return;

    setSaving(true);
    try {
      // Try user's own config first, then fallback to admin's global config
      let globalConfig: any = null;
      const { data: ownSettings } = await supabase
        .from("settings")
        .select("value")
        .eq("user_id", user.id)
        .eq("key", "uazapi_global")
        .maybeSingle();

      if (ownSettings?.value) {
        globalConfig = ownSettings.value as any;
      }

      // Fallback: fetch admin's config via security definer function
      if (!globalConfig?.baseUrl || !globalConfig?.adminToken) {
        const { data: adminConfig } = await supabase.rpc("get_admin_uazapi_config");
        if (adminConfig) {
          globalConfig = adminConfig as any;
        }
      }

      if (!globalConfig?.baseUrl || !globalConfig?.adminToken) {
        toast.error("Nenhuma configuração de API WhatsApp encontrada. Solicite ao administrador.");
        setSaving(false);
        return;
      }

      // First, create instance record in DB
      const result = await addInstance({
        name: newName.trim(),
        base_url: globalConfig.baseUrl,
        admin_token: globalConfig.adminToken,
        instance_token: "",
        instance_name: newName.trim(),
      });

      if (result?.error) {
        toast.error("Erro ao salvar instância: " + result.error.message);
        setSaving(false);
        return;
      }

      const instanceId = (result?.data as any)?.id;

      // Call create-instance on UazAPI to auto-generate instance token
      const { data: createData, error: createError } = await supabase.functions.invoke("uazapi-instance", {
        body: { action: "create-instance", instanceId, instanceName: newName.trim() },
      });

      if (createError) {
        toast.warning("Instância salva, mas não foi possível criar na UazAPI automaticamente. Verifique a configuração.");
      } else if (createData?.error) {
        toast.warning("Instância salva. Aviso da UazAPI: " + extractError(createData, ""));
      } else if (createData?.instanceToken) {
        // Update instance token in DB
        await supabase.from("whatsapp_instances").update({
          instance_token: createData.instanceToken,
          instance_name: createData.instanceName || newName.trim(),
        } as any).eq("id", instanceId);
        toast.success("Instância criada e configurada automaticamente!");
      } else {
        toast.success("Instância adicionada!");
      }

      await load();
      setDialogOpen(false);
      setNewName("");
    } catch (err: any) {
      toast.error("Erro: " + (err.message || "Tente novamente"));
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remover esta instância?")) return;
    const { error } = await deleteInstance(id);
    if (error) toast.error("Erro ao remover.");
    else toast.success("Instância removida.");
  };

  const handleSetDefault = async (id: string) => {
    await setDefault(id);
    toast.success("Instância padrão atualizada.");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="font-heading">Instâncias WhatsApp</CardTitle>
              <CardDescription>Gerencie suas conexões WhatsApp. A URL e Admin Token são configurados na aba "API WhatsApp".</CardDescription>
            </div>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-1 h-4 w-4" /> Nova Instância
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Nova Instância WhatsApp</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Nome da Instância *</Label>
                    <Input
                      placeholder="Ex: Atendimento, Vendas, Suporte..."
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                    />
                    <p className="text-xs text-muted-foreground">
                      A instância será criada automaticamente na UazAPI com o token gerado pelo sistema.
                    </p>
                  </div>
                  <Button onClick={handleAdd} disabled={saving} className="w-full">
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                    Criar Instância
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : instances.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Smartphone className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">Nenhuma instância configurada.</p>
            <p className="text-xs text-muted-foreground mt-1">Configure a API WhatsApp primeiro e depois adicione instâncias.</p>
            <Button variant="outline" className="mt-4" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Adicionar primeira instância
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {instances.map((inst) => (
            <InstanceCard
              key={inst.id}
              instance={inst}
              automations={linkedAutomations.filter((a: any) => a.instance_id === inst.id)}
              onUpdate={load}
              onSetDefault={handleSetDefault}
              onDelete={handleDelete}
              onRename={async (id, name) => {
                const { error } = await updateInstance(id, { name } as any);
                if (error) toast.error("Erro ao renomear.");
                else toast.success("Nome atualizado.");
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
