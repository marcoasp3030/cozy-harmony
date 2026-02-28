import { useState } from "react";
import { Wifi, WifiOff, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

const SettingsPage = () => {
  const [baseUrl, setBaseUrl] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [instanceToken, setInstanceToken] = useState("");
  const [testing, setTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "connected" | "error">("idle");

  const testConnection = async () => {
    setTesting(true);
    // Simulate test
    await new Promise((r) => setTimeout(r, 1500));
    if (baseUrl && instanceToken) {
      setConnectionStatus("connected");
      toast.success("Conexão estabelecida com sucesso!");
    } else {
      setConnectionStatus("error");
      toast.error("Falha na conexão. Verifique os dados.");
    }
    setTesting(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold">Configurações</h1>
        <p className="text-sm text-muted-foreground">Gerencie as configurações do sistema</p>
      </div>

      <Tabs defaultValue="connection" className="space-y-4">
        <TabsList>
          <TabsTrigger value="connection">Conexão UazAPI</TabsTrigger>
          <TabsTrigger value="company">Empresa</TabsTrigger>
          <TabsTrigger value="users">Usuários</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
        </TabsList>

        <TabsContent value="connection">
          <Card>
            <CardHeader>
              <CardTitle className="font-heading">Conexão UazAPI</CardTitle>
              <CardDescription>
                Configure a conexão com sua instância UazAPI
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>URL da Instância</Label>
                <Input
                  placeholder="https://seudominio.uazapi.com"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Admin Token</Label>
                <Input
                  type="password"
                  placeholder="Token de administrador"
                  value={adminToken}
                  onChange={(e) => setAdminToken(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Instance Token</Label>
                <Input
                  type="password"
                  placeholder="Token da instância"
                  value={instanceToken}
                  onChange={(e) => setInstanceToken(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-4">
                <Button onClick={testConnection} disabled={testing}>
                  {testing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : connectionStatus === "connected" ? (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  ) : (
                    <Wifi className="mr-2 h-4 w-4" />
                  )}
                  Testar Conexão
                </Button>

                {connectionStatus === "connected" && (
                  <span className="flex items-center gap-2 text-sm text-success">
                    <Wifi className="h-4 w-4" />
                    Conectado
                  </span>
                )}
                {connectionStatus === "error" && (
                  <span className="flex items-center gap-2 text-sm text-destructive">
                    <WifiOff className="h-4 w-4" />
                    Falha na conexão
                  </span>
                )}
              </div>

              <Button className="w-full">Salvar Configurações</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="company">
          <Card>
            <CardHeader>
              <CardTitle className="font-heading">Dados da Empresa</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Nome da Empresa</Label>
                <Input placeholder="Nutricar" />
              </div>
              <div className="space-y-2">
                <Label>Fuso Horário</Label>
                <Input value="America/Sao_Paulo" readOnly />
              </div>
              <Button>Salvar</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users">
          <Card>
            <CardHeader>
              <CardTitle className="font-heading">Usuários</CardTitle>
              <CardDescription>Gerencie os usuários do sistema</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Em breve...</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="webhooks">
          <Card>
            <CardHeader>
              <CardTitle className="font-heading">Webhooks</CardTitle>
              <CardDescription>Configure URLs para receber eventos</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>URL do Webhook</Label>
                <Input placeholder="https://seu-servidor.com/webhook" />
              </div>
              <Button>Salvar</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SettingsPage;
