import { useState, useEffect, useCallback } from "react";
import { Plus, FileText, Edit, Trash2, ImageIcon, Video, Mic, File, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

interface Template {
  id: string;
  name: string;
  category: string | null;
  type: string;
  content: string;
  media_url: string | null;
  variables: string[] | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

const categoryOptions = [
  { value: "boas-vindas", label: "Boas-vindas" },
  { value: "promoções", label: "Promoções" },
  { value: "confirmação", label: "Confirmação" },
  { value: "suporte", label: "Suporte" },
  { value: "cobrança", label: "Cobrança" },
  { value: "lembrete", label: "Lembrete" },
  { value: "personalizado", label: "Personalizado" },
];

const typeOptions = [
  { value: "text", label: "Texto", icon: FileText },
  { value: "image", label: "Imagem", icon: ImageIcon },
  { value: "video", label: "Vídeo", icon: Video },
  { value: "audio", label: "Áudio", icon: Mic },
  { value: "document", label: "Documento", icon: File },
];

const categoryColors: Record<string, string> = {
  "boas-vindas": "bg-success/15 text-success",
  "promoções": "bg-warning/15 text-warning",
  "confirmação": "bg-info/15 text-info",
  "suporte": "bg-primary/15 text-primary",
  "cobrança": "bg-destructive/15 text-destructive",
  "lembrete": "bg-accent text-accent-foreground",
  "personalizado": "bg-muted text-muted-foreground",
};

const typeIcons: Record<string, React.ElementType> = {
  text: FileText, image: ImageIcon, video: Video, audio: Mic, document: File,
};

const extractVariables = (content: string): string[] => {
  const matches = content.match(/\{\{(\w+)\}\}/g) || [];
  return [...new Set(matches.map((m) => m.replace(/\{\{|\}\}/g, "")))];
};

const Templates = () => {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState("personalizado");
  const [formType, setFormType] = useState("text");
  const [formContent, setFormContent] = useState("");
  const [formMediaUrl, setFormMediaUrl] = useState("");

  const loadTemplates = useCallback(async () => {
    const { data, error } = await supabase
      .from("templates")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      toast.error("Erro ao carregar templates");
      return;
    }
    setTemplates((data as Template[]) || []);
  }, []);

  useEffect(() => {
    setLoading(true);
    loadTemplates().finally(() => setLoading(false));
  }, [loadTemplates]);

  const openCreateDialog = () => {
    setEditingTemplate(null);
    setFormName("");
    setFormCategory("personalizado");
    setFormType("text");
    setFormContent("");
    setFormMediaUrl("");
    setDialogOpen(true);
  };

  const openEditDialog = (t: Template) => {
    setEditingTemplate(t);
    setFormName(t.name);
    setFormCategory(t.category || "personalizado");
    setFormType(t.type);
    setFormContent(t.content);
    setFormMediaUrl(t.media_url || "");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim() || !formContent.trim()) {
      toast.error("Nome e conteúdo são obrigatórios");
      return;
    }

    setSaving(true);
    const variables = extractVariables(formContent);
    const payload = {
      name: formName.trim(),
      category: formCategory,
      type: formType,
      content: formContent.trim(),
      media_url: formMediaUrl.trim() || null,
      variables,
      created_by: user?.id || null,
    };

    try {
      if (editingTemplate) {
        const { error } = await supabase
          .from("templates")
          .update(payload)
          .eq("id", editingTemplate.id);
        if (error) throw error;
        toast.success("Template atualizado!");
      } else {
        const { error } = await supabase.from("templates").insert(payload);
        if (error) throw error;
        toast.success("Template criado!");
      }
      setDialogOpen(false);
      loadTemplates();
    } catch (err: any) {
      toast.error("Erro: " + (err.message || "Tente novamente"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const { error } = await supabase.from("templates").delete().eq("id", deleteId);
      if (error) throw error;
      toast.success("Template excluído");
      setDeleteId(null);
      loadTemplates();
    } catch (err: any) {
      toast.error("Erro ao excluir: " + (err.message || "Tente novamente"));
    }
  };

  const filtered = templates.filter((t) => {
    const matchSearch = !searchTerm
      || t.name.toLowerCase().includes(searchTerm.toLowerCase())
      || t.content.toLowerCase().includes(searchTerm.toLowerCase());
    const matchCategory = filterCategory === "all" || t.category === filterCategory;
    return matchSearch && matchCategory;
  });

  const previewVars = extractVariables(formContent);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">Templates</h1>
          <p className="text-sm text-muted-foreground">
            Modelos de mensagens reutilizáveis
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Novo Template
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar template..."
            className="pl-9"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {categoryOptions.map((c) => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <FileText className="h-12 w-12 mb-3 opacity-30" />
          <p className="text-sm">{searchTerm || filterCategory !== "all" ? "Nenhum template encontrado" : "Nenhum template criado ainda"}</p>
          {!searchTerm && filterCategory === "all" && (
            <Button variant="outline" className="mt-3" onClick={openCreateDialog}>
              <Plus className="mr-2 h-4 w-4" /> Criar primeiro template
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((template) => {
            const TypeIcon = typeIcons[template.type] || FileText;
            return (
              <Card key={template.id} className="transition-all duration-200 hover:shadow-md">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                        <TypeIcon className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div>
                        <h3 className="font-heading font-semibold">{template.name}</h3>
                        <Badge variant="secondary" className={categoryColors[template.category || ""] || ""}>
                          {template.category || "personalizado"}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-lg bg-muted p-3">
                    <p className="text-sm text-muted-foreground line-clamp-3">
                      {template.content}
                    </p>
                  </div>

                  {(template.variables?.length ?? 0) > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {template.variables!.map((v) => (
                        <Badge key={v} variant="outline" className="text-xs">
                          {`{{${v}}}`}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="mt-4 flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => openEditDialog(template)}>
                      <Edit className="mr-1 h-3 w-3" />
                      Editar
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteId(template.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? "Editar Template" : "Novo Template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nome</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Ex: Boas-vindas" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Categoria</Label>
                <Select value={formCategory} onValueChange={setFormCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {categoryOptions.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Tipo</Label>
                <Select value={formType} onValueChange={setFormType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {typeOptions.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {formType !== "text" && (
              <div>
                <Label>URL da Mídia</Label>
                <Input value={formMediaUrl} onChange={(e) => setFormMediaUrl(e.target.value)} placeholder="https://..." />
              </div>
            )}
            <div>
              <Label>Conteúdo</Label>
              <Textarea
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                placeholder="Olá {{nome}}, tudo bem? Use {{variavel}} para personalizar."
                rows={5}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Use {"{{variavel}}"} para inserir variáveis dinâmicas.
              </p>
            </div>
            {previewVars.length > 0 && (
              <div>
                <Label className="text-xs text-muted-foreground">Variáveis detectadas</Label>
                <div className="mt-1 flex flex-wrap gap-1">
                  {previewVars.map((v) => (
                    <Badge key={v} variant="outline" className="text-xs">{`{{${v}}}`}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Salvando..." : editingTemplate ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir template?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O template será removido permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Templates;
