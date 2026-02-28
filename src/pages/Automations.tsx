import { Plus, Zap, Play, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

const mockAutomations = [
  { id: "1", name: "Boas-vindas", description: "Mensagem automática para novos contatos", trigger: "Primeiro contato", active: true, executions: 342 },
  { id: "2", name: "FAQ Automático", description: "Responde perguntas frequentes", trigger: "Palavra-chave", active: true, executions: 1205 },
  { id: "3", name: "Horário de Funcionamento", description: "Informa horário fora do expediente", trigger: "Horário", active: false, executions: 89 },
  { id: "4", name: "Pesquisa de Satisfação", description: "Envia pesquisa após atendimento", trigger: "Resolução de conversa", active: true, executions: 567 },
];

const Automations = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">Automações</h1>
          <p className="text-sm text-muted-foreground">
            Configure fluxos automáticos de atendimento
          </p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Nova Automação
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {mockAutomations.map((auto) => (
          <Card key={auto.id} className="transition-all duration-200 hover:shadow-md">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Zap className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-heading font-semibold">{auto.name}</h3>
                    <p className="text-sm text-muted-foreground">{auto.description}</p>
                  </div>
                </div>
                <Switch checked={auto.active} />
              </div>

              <div className="mt-4 flex items-center gap-4 text-sm">
                <Badge variant="secondary">
                  {auto.trigger}
                </Badge>
                <span className="text-muted-foreground">
                  {auto.executions.toLocaleString()} execuções
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default Automations;
