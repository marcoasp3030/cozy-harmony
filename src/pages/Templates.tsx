import { Plus, FileText, Edit, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const mockTemplates = [
  { id: "1", name: "Boas-vindas", category: "boas-vindas", type: "text", content: "Olá {{nome}}! Seja bem-vindo(a) à Nutricar! 🌿", variables: ["nome"] },
  { id: "2", name: "Promoção Mensal", category: "promoções", type: "image", content: "🔥 {{nome}}, temos uma oferta especial para você! Aproveite {{desconto}}% de desconto.", variables: ["nome", "desconto"] },
  { id: "3", name: "Confirmação de Pedido", category: "confirmação", type: "text", content: "✅ {{nome}}, seu pedido #{{pedido}} foi confirmado! Previsão de entrega: {{data}}", variables: ["nome", "pedido", "data"] },
  { id: "4", name: "Pesquisa de Satisfação", category: "suporte", type: "text", content: "Olá {{nome}}! Como foi sua experiência conosco? Responda de 1 a 5 ⭐", variables: ["nome"] },
];

const categoryColors: Record<string, string> = {
  "boas-vindas": "bg-success/15 text-success",
  "promoções": "bg-warning/15 text-warning",
  "confirmação": "bg-info/15 text-info",
  "suporte": "bg-primary/15 text-primary",
};

const Templates = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">Templates</h1>
          <p className="text-sm text-muted-foreground">
            Modelos de mensagens reutilizáveis
          </p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Novo Template
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {mockTemplates.map((template) => (
          <Card key={template.id} className="transition-all duration-200 hover:shadow-md">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="font-heading font-semibold">{template.name}</h3>
                    <Badge variant="secondary" className={categoryColors[template.category] || ""}>
                      {template.category}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-lg bg-muted p-3">
                <p className="text-sm text-muted-foreground line-clamp-3">
                  {template.content}
                </p>
              </div>

              {template.variables.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {template.variables.map((v) => (
                    <Badge key={v} variant="outline" className="text-xs">
                      {`{{${v}}}`}
                    </Badge>
                  ))}
                </div>
              )}

              <div className="mt-4 flex gap-2">
                <Button variant="outline" size="sm" className="flex-1">
                  <Edit className="mr-1 h-3 w-3" />
                  Editar
                </Button>
                <Button variant="ghost" size="sm" className="text-destructive">
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default Templates;
