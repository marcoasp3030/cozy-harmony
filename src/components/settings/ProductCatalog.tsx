import { useState, useEffect, useCallback, useRef } from "react";
import { Upload, Loader2, Trash2, Search, Package, FileSpreadsheet, CheckCircle2, AlertCircle, X, Download, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import * as XLSX from "xlsx";

type Product = {
  id: string;
  name: string;
  barcode: string | null;
  price: number;
  category: string | null;
  is_active: boolean;
};

type ColumnMapping = {
  name: string;
  barcode: string;
  price: string;
  category: string;
};

const ProductCatalog = () => {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 20;

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  // Import dialog
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [previewData, setPreviewData] = useState<Record<string, string>[]>([]);
  const [sheetColumns, setSheetColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({ name: "", barcode: "", price: "", category: "" });
  const [importStats, setImportStats] = useState<{ total: number; success: number; errors: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Add product dialog
  const [addOpen, setAddOpen] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: "", barcode: "", price: "", category: "" });
  const [addingProduct, setAddingProduct] = useState(false);

  const loadProducts = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      let query = supabase
        .from("products" as any)
        .select("id, name, barcode, price, category, is_active", { count: "exact" })
        .eq("user_id", user.id)
        .order("name")
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (search.trim()) {
        query = query.or(`name.ilike.%${search.trim()}%,barcode.eq.${search.trim()}`);
      }

      const { data, count, error } = await query;
      if (error) throw error;
      setProducts((data as any) || []);
      setTotalCount(count || 0);
    } catch (err: any) {
      toast.error("Erro ao carregar produtos: " + err.message);
    } finally {
      setLoading(false);
    }
  }, [user, page, search]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  // Clear selection when page/search changes
  useEffect(() => { setSelectedIds(new Set()); }, [page, search]);

  // Debounced search
  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Selection handlers
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === products.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(products.map(p => p.id)));
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Excluir ${selectedIds.size} produto(s) selecionado(s)?`)) return;
    setDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      const { error } = await supabase.from("products" as any).delete().in("id", ids);
      if (error) throw error;
      toast.success(`${ids.length} produto(s) excluído(s)`);
      setSelectedIds(new Set());
      loadProducts();
    } catch (err: any) {
      toast.error("Erro ao excluir: " + err.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteZeroPrice = async () => {
    if (!user) return;
    if (!confirm("Excluir todos os produtos com preço R$ 0,00?")) return;
    setDeleting(true);
    try {
      const { error, count } = await supabase
        .from("products" as any)
        .delete({ count: "exact" })
        .eq("user_id", user.id)
        .eq("price", 0);
      if (error) throw error;
      toast.success(`${count || 0} produto(s) sem valor excluído(s)`);
      setSelectedIds(new Set());
      loadProducts();
    } catch (err: any) {
      toast.error("Erro ao excluir: " + err.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = evt.target?.result;
        const workbook = XLSX.read(data, { type: "binary" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });

        if (json.length === 0) {
          toast.error("Planilha vazia");
          return;
        }

        const cols = Object.keys(json[0]);
        setSheetColumns(cols);
        setPreviewData(json.slice(0, 5));
        setImportStats(null);

        const autoMap: ColumnMapping = { name: "", barcode: "", price: "", category: "" };
        for (const col of cols) {
          const lower = col.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          if (!autoMap.name && (lower.includes("nome") || lower.includes("produto") || lower.includes("descricao") || lower === "name")) autoMap.name = col;
          if (!autoMap.barcode && (lower.includes("barcode") || lower.includes("codigo") || lower.includes("ean") || lower.includes("gtin") || lower.includes("cod_barras"))) autoMap.barcode = col;
          if (!autoMap.price && (lower.includes("preco") || lower.includes("valor") || lower.includes("price"))) autoMap.price = col;
          if (!autoMap.category && (lower.includes("categoria") || lower.includes("category") || lower.includes("grupo") || lower.includes("departamento"))) autoMap.category = col;
        }
        setMapping(autoMap);
        setImportOpen(true);
        (window as any).__importData = json;
      } catch (err) {
        toast.error("Erro ao ler arquivo. Verifique se é um CSV ou XLSX válido.");
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = "";
  };

  const handleImport = async () => {
    if (!user || !mapping.name) {
      toast.error("Mapeie pelo menos a coluna 'Nome do Produto'");
      return;
    }

    setImporting(true);
    const allData: Record<string, string>[] = (window as any).__importData || [];
    let success = 0;
    let errors = 0;
    const batchSize = 100;

    try {
      for (let i = 0; i < allData.length; i += batchSize) {
        const batch = allData.slice(i, i + batchSize);
        const rows = batch
          .map((row) => {
            const name = (row[mapping.name] || "").toString().trim();
            if (!name) return null;

            let price = 0;
            if (mapping.price && row[mapping.price]) {
              const priceStr = row[mapping.price].toString().replace(/[^\d.,\-]/g, "").replace(",", ".");
              price = parseFloat(priceStr) || 0;
            }

            return {
              user_id: user.id,
              name,
              barcode: mapping.barcode ? (row[mapping.barcode] || "").toString().trim() || null : null,
              price,
              category: mapping.category ? (row[mapping.category] || "").toString().trim() || null : null,
            };
          })
          .filter(Boolean);

        if (rows.length > 0) {
          const { error } = await supabase.from("products" as any).insert(rows as any);
          if (error) {
            console.error("Batch error:", error);
            errors += rows.length;
          } else {
            success += rows.length;
          }
        }
      }

      setImportStats({ total: allData.length, success, errors });
      if (success > 0) {
        toast.success(`${success} produtos importados com sucesso!`);
        loadProducts();
      }
      if (errors > 0) {
        toast.error(`${errors} produtos falharam na importação`);
      }
    } catch (err: any) {
      toast.error("Erro na importação: " + err.message);
    } finally {
      setImporting(false);
      delete (window as any).__importData;
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("products" as any).delete().eq("id", id);
    if (error) {
      toast.error("Erro ao excluir produto");
    } else {
      toast.success("Produto excluído");
      loadProducts();
    }
  };

  const handleDeleteAll = async () => {
    if (!user) return;
    if (!confirm("Tem certeza que deseja excluir TODOS os produtos? Esta ação não pode ser desfeita.")) return;
    const { error } = await supabase.from("products" as any).delete().eq("user_id", user.id);
    if (error) {
      toast.error("Erro ao excluir produtos");
    } else {
      toast.success("Todos os produtos foram excluídos");
      loadProducts();
    }
  };

  const handleAddProduct = async () => {
    if (!user || !newProduct.name.trim()) {
      toast.error("Nome do produto é obrigatório");
      return;
    }
    setAddingProduct(true);
    try {
      const { error } = await supabase.from("products" as any).insert({
        user_id: user.id,
        name: newProduct.name.trim(),
        barcode: newProduct.barcode.trim() || null,
        price: parseFloat(newProduct.price.replace(",", ".")) || 0,
        category: newProduct.category.trim() || null,
      } as any);
      if (error) throw error;
      toast.success("Produto adicionado!");
      setNewProduct({ name: "", barcode: "", price: "", category: "" });
      setAddOpen(false);
      loadProducts();
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setAddingProduct(false);
    }
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Nome", "Codigo_Barras", "Preco", "Categoria"],
      ["Arroz Integral 1kg", "7891234567890", "8.99", "Alimentos"],
      ["Leite Integral 1L", "7891234567891", "5.49", "Laticínios"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Produtos");
    XLSX.writeFile(wb, "modelo_produtos.xlsx");
  };

  const totalPages = Math.ceil(totalCount / pageSize);
  const allSelected = products.length > 0 && selectedIds.size === products.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < products.length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="font-heading">Catálogo de Produtos</CardTitle>
                <CardDescription>
                  {totalCount > 0 ? `${totalCount} produtos cadastrados` : "Importe sua planilha de produtos"}
                </CardDescription>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={downloadTemplate}>
                <Download className="mr-1.5 h-3.5 w-3.5" /> Modelo
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Adicionar
              </Button>
              <Button size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="mr-1.5 h-3.5 w-3.5" /> Importar CSV/XLSX
              </Button>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileSelect} className="hidden" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search & Actions */}
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Pesquisar por nome ou código de barras..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              {selectedIds.size > 0 && (
                <Button variant="destructive" size="sm" onClick={handleDeleteSelected} disabled={deleting}>
                  {deleting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
                  Excluir {selectedIds.size} selecionado(s)
                </Button>
              )}
              {totalCount > 0 && (
                <>
                  <Button variant="outline" size="sm" onClick={handleDeleteZeroPrice} disabled={deleting}>
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Sem valor
                  </Button>
                  <Button variant="destructive" size="sm" onClick={handleDeleteAll} disabled={deleting}>
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Limpar tudo
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileSpreadsheet className="h-12 w-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">
                {search ? "Nenhum produto encontrado" : "Nenhum produto cadastrado. Importe uma planilha para começar."}
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allSelected}
                          ref={(el) => {
                            if (el) (el as any).indeterminate = someSelected;
                          }}
                          onCheckedChange={toggleSelectAll}
                        />
                      </TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead>Código de Barras</TableHead>
                      <TableHead className="text-right">Preço</TableHead>
                      <TableHead>Categoria</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.map((p) => (
                      <TableRow key={p.id} className={selectedIds.has(p.id) ? "bg-muted/50" : ""}>
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(p.id)}
                            onCheckedChange={() => toggleSelect(p.id)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{p.barcode || "—"}</TableCell>
                        <TableCell className="text-right">
                          <span className={p.price === 0 ? "text-destructive" : ""}>
                            {p.price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                          </span>
                        </TableCell>
                        <TableCell>
                          {p.category ? (
                            <Badge variant="secondary" className="text-xs">{p.category}</Badge>
                          ) : "—"}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(p.id)}>
                            <X className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Página {page + 1} de {totalPages}
                  </p>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                      Anterior
                    </Button>
                    <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                      Próxima
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Import Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              Importar Produtos
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-3">
              <p className="text-sm font-medium">Mapeie as colunas da planilha:</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Nome do Produto *</Label>
                  <Select value={mapping.name} onValueChange={(v) => setMapping(m => ({ ...m, name: v }))}>
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      {sheetColumns.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Código de Barras</Label>
                  <Select value={mapping.barcode} onValueChange={(v) => setMapping(m => ({ ...m, barcode: v }))}>
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Nenhum</SelectItem>
                      {sheetColumns.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Preço</Label>
                  <Select value={mapping.price} onValueChange={(v) => setMapping(m => ({ ...m, price: v }))}>
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Nenhum</SelectItem>
                      {sheetColumns.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Categoria</Label>
                  <Select value={mapping.category} onValueChange={(v) => setMapping(m => ({ ...m, category: v }))}>
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Nenhum</SelectItem>
                      {sheetColumns.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Pré-visualização (primeiras 5 linhas):</p>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {sheetColumns.slice(0, 6).map(c => (
                        <TableHead key={c} className="text-xs whitespace-nowrap">{c}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewData.map((row, i) => (
                      <TableRow key={i}>
                        {sheetColumns.slice(0, 6).map(c => (
                          <TableCell key={c} className="text-xs">{String(row[c] || "")}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                Total de linhas na planilha: {(window as any).__importData?.length || 0}
              </p>
            </div>

            {importStats && (
              <div className={`rounded-lg p-4 ${importStats.errors > 0 ? "bg-destructive/10" : "bg-success/10"}`}>
                <div className="flex items-center gap-2">
                  {importStats.errors > 0 ? (
                    <AlertCircle className="h-5 w-5 text-destructive" />
                  ) : (
                    <CheckCircle2 className="h-5 w-5 text-success" />
                  )}
                  <div>
                    <p className="text-sm font-medium">
                      {importStats.success} de {importStats.total} importados
                    </p>
                    {importStats.errors > 0 && (
                      <p className="text-xs text-destructive">{importStats.errors} falharam</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Cancelar</Button>
            <Button onClick={handleImport} disabled={importing || !mapping.name}>
              {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Importar Produtos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Product Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar Produto</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Nome *</Label>
              <Input placeholder="Ex: Arroz Integral 1kg" value={newProduct.name} onChange={e => setNewProduct(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Código de Barras</Label>
              <Input placeholder="Ex: 7891234567890" value={newProduct.barcode} onChange={e => setNewProduct(p => ({ ...p, barcode: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Preço</Label>
              <Input placeholder="Ex: 8.99" value={newProduct.price} onChange={e => setNewProduct(p => ({ ...p, price: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Categoria</Label>
              <Input placeholder="Ex: Alimentos" value={newProduct.category} onChange={e => setNewProduct(p => ({ ...p, category: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancelar</Button>
            <Button onClick={handleAddProduct} disabled={addingProduct || !newProduct.name.trim()}>
              {addingProduct ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProductCatalog;
