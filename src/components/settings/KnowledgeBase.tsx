import { useState, useEffect } from "react";
import { Plus, Trash2, Edit2, Save, X, GripVertical, BookOpen, FolderOpen, ChevronDown, ChevronRight, Tag, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface Category {
  id: string;
  name: string;
  description: string | null;
  color: string;
  always_inject: boolean;
  position: number;
}

interface Article {
  id: string;
  category_id: string;
  title: string;
  content: string;
  tags: string[];
  is_active: boolean;
}

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

const KnowledgeBase = () => {
  const { user } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCat, setExpandedCat] = useState<string | null>(null);

  // Category dialog
  const [catDialog, setCatDialog] = useState(false);
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [catForm, setCatForm] = useState({ name: "", description: "", color: COLORS[0], always_inject: false });

  // Article dialog
  const [artDialog, setArtDialog] = useState(false);
  const [editingArt, setEditingArt] = useState<Article | null>(null);
  const [artForm, setArtForm] = useState({ title: "", content: "", tags: "", category_id: "", is_active: true });

  const load = async () => {
    if (!user) return;
    const [{ data: cats }, { data: arts }] = await Promise.all([
      supabase.from("knowledge_categories").select("*").order("position"),
      supabase.from("knowledge_articles").select("*").order("created_at"),
    ]);
    setCategories((cats as any[]) || []);
    setArticles((arts as any[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user]);

  // ── Category CRUD ──
  const openCatDialog = (cat?: Category) => {
    if (cat) {
      setEditingCat(cat);
      setCatForm({ name: cat.name, description: cat.description || "", color: cat.color, always_inject: cat.always_inject });
    } else {
      setEditingCat(null);
      setCatForm({ name: "", description: "", color: COLORS[categories.length % COLORS.length], always_inject: false });
    }
    setCatDialog(true);
  };

  const saveCat = async () => {
    if (!catForm.name.trim()) { toast.error("Nome é obrigatório"); return; }
    if (editingCat) {
      await supabase.from("knowledge_categories").update({
        name: catForm.name, description: catForm.description || null, color: catForm.color, always_inject: catForm.always_inject,
      }).eq("id", editingCat.id);
    } else {
      await supabase.from("knowledge_categories").insert({
        name: catForm.name, description: catForm.description || null, color: catForm.color,
        always_inject: catForm.always_inject, position: categories.length, created_by: user!.id,
      });
    }
    setCatDialog(false);
    toast.success(editingCat ? "Categoria atualizada" : "Categoria criada");
    load();
  };

  const deleteCat = async (id: string) => {
    await supabase.from("knowledge_categories").delete().eq("id", id);
    toast.success("Categoria excluída");
    load();
  };

  // ── Article CRUD ──
  const openArtDialog = (catId: string, art?: Article) => {
    if (art) {
      setEditingArt(art);
      setArtForm({ title: art.title, content: art.content, tags: art.tags.join(", "), category_id: art.category_id, is_active: art.is_active });
    } else {
      setEditingArt(null);
      setArtForm({ title: "", content: "", tags: "", category_id: catId, is_active: true });
    }
    setArtDialog(true);
  };

  const saveArt = async () => {
    if (!artForm.title.trim() || !artForm.content.trim()) { toast.error("Título e conteúdo são obrigatórios"); return; }
    const tags = artForm.tags.split(",").map(t => t.trim()).filter(Boolean);
    if (editingArt) {
      await supabase.from("knowledge_articles").update({
        title: artForm.title, content: artForm.content, tags, is_active: artForm.is_active,
      }).eq("id", editingArt.id);
    } else {
      await supabase.from("knowledge_articles").insert({
        title: artForm.title, content: artForm.content, tags, category_id: artForm.category_id,
        is_active: artForm.is_active, created_by: user!.id,
      });
    }
    setArtDialog(false);
    toast.success(editingArt ? "Artigo atualizado" : "Artigo criado");
    load();
  };

  const deleteArt = async (id: string) => {
    await supabase.from("knowledge_articles").delete().eq("id", id);
    toast.success("Artigo excluído");
    load();
  };

  const toggleArt = async (art: Article) => {
    await supabase.from("knowledge_articles").update({ is_active: !art.is_active }).eq("id", art.id);
    load();
  };

  if (loading) return <div className="flex justify-center py-12"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 font-heading">
                <BookOpen className="h-5 w-5 text-primary" />
                Base de Conhecimento
              </CardTitle>
              <CardDescription>
                Alimente a IA com informações da empresa para respostas mais precisas
              </CardDescription>
            </div>
            <Button onClick={() => openCatDialog()} size="sm">
              <Plus className="mr-1 h-4 w-4" /> Nova Categoria
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {categories.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FolderOpen className="h-12 w-12 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">Nenhuma categoria criada</p>
              <p className="text-xs text-muted-foreground mt-1">Crie categorias como "Horários", "Formas de Pagamento", "Políticas" etc.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {categories.map(cat => {
                const catArticles = articles.filter(a => a.category_id === cat.id);
                const isExpanded = expandedCat === cat.id;
                return (
                  <div key={cat.id} className="rounded-lg border border-border overflow-hidden">
                    {/* Category header */}
                    <div
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => setExpandedCat(isExpanded ? null : cat.id)}
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{cat.name}</span>
                          <Badge variant="secondary" className="text-[10px]">{catArticles.length} artigo{catArticles.length !== 1 ? "s" : ""}</Badge>
                          {cat.always_inject && (
                            <Badge className="text-[10px] bg-primary/15 text-primary border-0">
                              <Sparkles className="h-3 w-3 mr-0.5" /> Sempre ativo
                            </Badge>
                          )}
                        </div>
                        {cat.description && <p className="text-xs text-muted-foreground truncate">{cat.description}</p>}
                      </div>
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openCatDialog(cat)}>
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Excluir categoria?</AlertDialogTitle>
                              <AlertDialogDescription>Todos os artigos desta categoria serão excluídos permanentemente.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteCat(cat.id)}>Excluir</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>

                    {/* Articles list */}
                    {isExpanded && (
                      <div className="border-t border-border bg-muted/30 px-4 py-3 space-y-2">
                        {catArticles.map(art => (
                          <div key={art.id} className="flex items-start gap-3 rounded-md border border-border bg-background p-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-medium ${!art.is_active ? "line-through text-muted-foreground" : ""}`}>{art.title}</span>
                                {!art.is_active && <Badge variant="outline" className="text-[10px]">Inativo</Badge>}
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{art.content}</p>
                              {art.tags.length > 0 && (
                                <div className="flex gap-1 mt-1.5 flex-wrap">
                                  {art.tags.map(t => (
                                    <span key={t} className="inline-flex items-center gap-0.5 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                                      <Tag className="h-2.5 w-2.5" />{t}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <Switch checked={art.is_active} onCheckedChange={() => toggleArt(art)} className="scale-75" />
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openArtDialog(cat.id, art)}>
                                <Edit2 className="h-3.5 w-3.5" />
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Excluir artigo?</AlertDialogTitle>
                                    <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => deleteArt(art.id)}>Excluir</AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </div>
                        ))}
                        <Button variant="outline" size="sm" className="w-full mt-1" onClick={() => openArtDialog(cat.id)}>
                          <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar Artigo
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Info box */}
          <div className="rounded-lg border border-border bg-muted/50 p-4 mt-4 space-y-2">
            <p className="text-sm font-medium flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Como funciona</p>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
              <li><strong>"Sempre ativo"</strong>: categorias marcadas são injetadas em TODA resposta da IA (ideal para horários, políticas, formas de pagamento)</li>
              <li><strong>Sob demanda</strong>: categorias normais são consultadas apenas quando a pergunta do cliente corresponde às tags ou título dos artigos</li>
              <li>Use <strong>tags</strong> para melhorar a correspondência (ex: "pix, pagamento, chave, transferência")</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Category Dialog */}
      <Dialog open={catDialog} onOpenChange={setCatDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCat ? "Editar Categoria" : "Nova Categoria"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input placeholder="Ex: Formas de Pagamento" value={catForm.name} onChange={e => setCatForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Input placeholder="Breve descrição da categoria" value={catForm.description} onChange={e => setCatForm(p => ({ ...p, description: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Cor</Label>
              <div className="flex gap-2">
                {COLORS.map(c => (
                  <button key={c} onClick={() => setCatForm(p => ({ ...p, color: c }))}
                    className={`h-7 w-7 rounded-full border-2 transition-all ${catForm.color === c ? "border-foreground scale-110" : "border-transparent"}`}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Sempre ativo</Label>
                <p className="text-xs text-muted-foreground">Injetar em toda resposta da IA</p>
              </div>
              <Switch checked={catForm.always_inject} onCheckedChange={v => setCatForm(p => ({ ...p, always_inject: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatDialog(false)}>Cancelar</Button>
            <Button onClick={saveCat}><Save className="mr-1 h-4 w-4" /> Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Article Dialog */}
      <Dialog open={artDialog} onOpenChange={setArtDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingArt ? "Editar Artigo" : "Novo Artigo"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Título *</Label>
              <Input placeholder="Ex: Horário de funcionamento" value={artForm.title} onChange={e => setArtForm(p => ({ ...p, title: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Conteúdo *</Label>
              <Textarea
                placeholder="Informação que a IA deve usar para responder os clientes..."
                rows={6}
                value={artForm.content}
                onChange={e => setArtForm(p => ({ ...p, content: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Escreva de forma clara e direta. A IA usará este texto como referência.</p>
            </div>
            <div className="space-y-2">
              <Label>Tags (separadas por vírgula)</Label>
              <Input placeholder="horário, funcionamento, aberto, fechado" value={artForm.tags} onChange={e => setArtForm(p => ({ ...p, tags: e.target.value }))} />
              <p className="text-xs text-muted-foreground">Tags ajudam a IA a encontrar este artigo quando o cliente perguntar sobre o tema</p>
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm">Artigo ativo</Label>
              <Switch checked={artForm.is_active} onCheckedChange={v => setArtForm(p => ({ ...p, is_active: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArtDialog(false)}>Cancelar</Button>
            <Button onClick={saveArt}><Save className="mr-1 h-4 w-4" /> Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default KnowledgeBase;
