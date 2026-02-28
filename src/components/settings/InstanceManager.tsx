import { useState } from "react";
import {
  Plus, Trash2, Star, Loader2, QrCode, Wifi, WifiOff, Save, Unplug,
  CheckCircle2, RefreshCw, Smartphone, Clock, Eye, EyeOff,
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

const extractError = (data: any, fallback: string): string => {
  if (!data) return fallback;
  const detail = data.details ? (typeof data.details === "string" ? data.details : JSON.stringify(data.details, null, 2)) : "";
  const debug = data.debug ? (typeof data.debug === "string" ? data.debug : JSON.stringify(data.debug, null, 2)) : "";
  const mainError = data.error || data.message || "";
  const extra = detail || debug;
  return extra ? `${mainError}\n\nDetalhes: ${extra}` : mainError || fallback;
};

interface InstanceCardProps {
  instance: WhatsAppInstance;
  onUpdate: () => void;
  onSetDefault: (id: string) => void;
  onDelete: (id: string) => void;
}

const InstanceCard = ({ instance, onUpdate, onSetDefault, onDelete }: InstanceCardProps) => {
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
        // Update instance status in DB
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

  const statusColor = connectionStatus === "connected" ? "border-emerald-500/30" :
    connectionStatus === "disconnected" || connectionStatus === "error" ? "border-destructive/30" : "border-border";

  return (
    <Card className={`border-2 ${statusColor}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base font-heading">{instance.name}</CardTitle>
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
        {/* Info */}
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
          <p>URL: <span className="font-mono">{instance.base_url}</span></p>
          {instance.instance_name && <p>Instância: {instance.instance_name}</p>}
        </div>

        {lastChecked && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            Verificado: {lastChecked.toLocaleTimeString("pt-BR")}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={connectQr} disabled={loadingQr}>
            {loadingQr ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <QrCode className="mr-1 h-3 w-3" />}
            QR Code
          </Button>
          {connectionStatus === "connected" && (
            <Button size="sm" variant="destructive" onClick={disconnect}>
              <Unplug className="mr-1 h-3 w-3" /> Desconectar
            </Button>
          )}
        </div>

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
  const { instances, loading, load, addInstance, updateInstance, deleteInstance, setDefault } = useWhatsAppInstances();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("");
  const [newAdminToken, setNewAdminToken] = useState("");
  const [newInstanceToken, setNewInstanceToken] = useState("");
  const [newInstanceName, setNewInstanceName] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!newName.trim() || !newBaseUrl.trim()) {
      toast.error("Nome e URL são obrigatórios.");
      return;
    }
    setSaving(true);
    const result = await addInstance({
      name: newName.trim(),
      base_url: newBaseUrl.trim(),
      admin_token: newAdminToken.trim(),
      instance_token: newInstanceToken.trim(),
      instance_name: newInstanceName.trim(),
    });
    if (result?.error) {
      toast.error("Erro ao adicionar: " + result.error.message);
    } else {
      toast.success("Instância adicionada!");
      setDialogOpen(false);
      setNewName("");
      setNewBaseUrl("");
      setNewAdminToken("");
      setNewInstanceToken("");
      setNewInstanceName("");
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
              <CardDescription>Gerencie suas conexões WhatsApp via UazAPI</CardDescription>
            </div>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-1 h-4 w-4" /> Nova Instância
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Adicionar Instância WhatsApp</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Nome *</Label>
                    <Input placeholder="Ex: Atendimento, Vendas..." value={newName} onChange={(e) => setNewName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>URL da UazAPI *</Label>
                    <Input placeholder="https://seudominio.uazapi.com" value={newBaseUrl} onChange={(e) => setNewBaseUrl(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Admin Token</Label>
                    <Input type="password" placeholder="Token de administrador" value={newAdminToken} onChange={(e) => setNewAdminToken(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Nome da Instância</Label>
                    <Input placeholder="Nome na UazAPI (opcional)" value={newInstanceName} onChange={(e) => setNewInstanceName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Instance Token</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          type={showToken ? "text" : "password"}
                          placeholder="Token da instância"
                          value={newInstanceToken}
                          onChange={(e) => setNewInstanceToken(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => setShowToken(!showToken)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  </div>
                  <Button onClick={handleAdd} disabled={saving} className="w-full">
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                    Adicionar
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
            <p className="text-xs text-muted-foreground mt-1">Adicione uma instância WhatsApp para começar.</p>
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
              onUpdate={load}
              onSetDefault={handleSetDefault}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
