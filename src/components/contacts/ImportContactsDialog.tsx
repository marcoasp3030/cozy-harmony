import { useState, useCallback, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  X,
  Download,
  Tag,
  Plus,
} from "lucide-react";
import { validatePhone } from "@/lib/validators";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ImportContactsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete: () => void;
}

type Step = "upload" | "mapping" | "validation" | "importing" | "done";

interface ParsedRow {
  [key: string]: string;
}

interface ColumnMapping {
  phone: string;
  name: string;
  email: string;
}

interface ValidationRow {
  original: ParsedRow;
  phone: string;
  phoneValid: boolean;
  phoneError?: string;
  name: string;
  email: string;
}

const ACCEPTED_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
];

const TEMPLATE_DATA = [
  { nome: "João Silva", telefone: "5511999998888", email: "joao@email.com" },
  { nome: "Maria Santos", telefone: "5521988887777", email: "maria@email.com" },
  { nome: "Pedro Oliveira", telefone: "5531977776666", email: "" },
];

const downloadTemplateExcel = () => {
  const ws = XLSX.utils.json_to_sheet(TEMPLATE_DATA);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Contatos");
  XLSX.writeFile(wb, "modelo_contatos.xlsx");
};

const downloadTemplateCsv = () => {
  const header = "nome,telefone,email";
  const rows = TEMPLATE_DATA.map((r) => `${r.nome},${r.telefone},${r.email}`);
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "modelo_contatos.csv";
  a.click();
  URL.revokeObjectURL(url);
};

const guessColumn = (headers: string[], keywords: string[]): string => {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const kw of keywords) {
    const found = lower.findIndex((h) => h.includes(kw));
    if (found !== -1) return headers[found];
  }
  return "";
};

const ImportContactsDialog = ({
  open,
  onOpenChange,
  onImportComplete,
}: ImportContactsDialogProps) => {
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawData, setRawData] = useState<ParsedRow[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({ phone: "", name: "", email: "" });
  const [validatedRows, setValidatedRows] = useState<ValidationRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importResult, setImportResult] = useState({ success: 0, failed: 0, duplicates: 0 });
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep("upload");
    setFileName("");
    setHeaders([]);
    setRawData([]);
    setMapping({ phone: "", name: "", email: "" });
    setValidatedRows([]);
    setImporting(false);
    setImportProgress(0);
    setImportResult({ success: 0, failed: 0, duplicates: 0 });
  };

  const handleClose = (open: boolean) => {
    if (!open) reset();
    onOpenChange(open);
  };

  const processFile = useCallback((file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type) && !file.name.endsWith(".csv")) {
      toast.error("Formato não suportado. Use .xlsx, .xls ou .csv");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Arquivo muito grande. Máximo 10MB.");
      return;
    }

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<ParsedRow>(sheet, { defval: "" });

        if (json.length === 0) {
          toast.error("Arquivo vazio ou sem dados válidos.");
          return;
        }

        const cols = Object.keys(json[0]);
        setHeaders(cols);
        setRawData(json.slice(0, 10000)); // Cap at 10k

        // Auto-detect columns
        setMapping({
          phone: guessColumn(cols, ["telefone", "phone", "celular", "whatsapp", "fone", "tel", "número", "numero"]),
          name: guessColumn(cols, ["nome", "name", "cliente", "contato"]),
          email: guessColumn(cols, ["email", "e-mail", "mail"]),
        });

        setStep("mapping");
      } catch {
        toast.error("Erro ao ler o arquivo. Verifique o formato.");
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleValidate = () => {
    if (!mapping.phone) {
      toast.error("Selecione a coluna de telefone.");
      return;
    }

    const rows: ValidationRow[] = rawData.map((row) => {
      const rawPhone = String(row[mapping.phone] || "").trim();
      const result = validatePhone(rawPhone);
      return {
        original: row,
        phone: result.formatted,
        phoneValid: result.valid,
        phoneError: result.error,
        name: mapping.name ? String(row[mapping.name] || "").trim().slice(0, 100) : "",
        email: mapping.email ? String(row[mapping.email] || "").trim().slice(0, 255) : "",
      };
    });

    setValidatedRows(rows);
    setStep("validation");
  };

  const validCount = validatedRows.filter((r) => r.phoneValid).length;
  const invalidCount = validatedRows.filter((r) => !r.phoneValid).length;

  const handleImport = async () => {
    setStep("importing");
    setImporting(true);

    const validRows = validatedRows.filter((r) => r.phoneValid);
    let success = 0;
    let failed = 0;
    let duplicates = 0;

    const batchSize = 50;
    for (let i = 0; i < validRows.length; i += batchSize) {
      const batch = validRows.slice(i, i + batchSize);
      const contacts = batch.map((r) => ({
        phone: r.phone,
        name: r.name || null,
        email: r.email || null,
      }));

      const { error, data } = await supabase
        .from("contacts")
        .upsert(contacts, { onConflict: "user_id,phone", ignoreDuplicates: true })
        .select();

      if (error) {
        failed += batch.length;
      } else {
        success += data?.length || 0;
        // Count duplicates as ones that were updated vs truly new
      }

      setImportProgress(Math.min(100, Math.round(((i + batchSize) / validRows.length) * 100)));
    }

    setImportResult({ success, failed, duplicates });
    setImporting(false);
    setStep("done");
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl">
            {step === "upload" && "Importar Contatos"}
            {step === "mapping" && "Mapear Colunas"}
            {step === "validation" && "Validação dos Dados"}
            {step === "importing" && "Importando..."}
            {step === "done" && "Importação Concluída"}
          </DialogTitle>
          <DialogDescription>
            {step === "upload" && "Arraste um arquivo Excel ou CSV para importar contatos."}
            {step === "mapping" && `${rawData.length} linhas encontradas em "${fileName}". Mapeie as colunas.`}
            {step === "validation" && "Revise os dados antes de importar."}
            {step === "importing" && "Aguarde enquanto os contatos são importados."}
            {step === "done" && "Veja o resumo da importação abaixo."}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Upload */}
        {step === "upload" && (
          <>
            <div
              className={cn(
                "flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 transition-all duration-200 cursor-pointer",
                dragActive
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-accent"
              )}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mb-4 h-12 w-12 text-primary opacity-60" />
              <p className="text-base font-medium">
                Arraste seu arquivo ou clique para selecionar
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Suporta Excel (.xlsx, .xls) e CSV • Máx 10MB
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) processFile(file);
                }}
              />
            </div>

            <div className="flex items-center justify-center gap-3 mt-3">
              <span className="text-xs text-muted-foreground">Baixar modelo:</span>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={downloadTemplateExcel}>
                <Download className="h-3 w-3" />
                Excel (.xlsx)
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={downloadTemplateCsv}>
                <Download className="h-3 w-3" />
                CSV
              </Button>
            </div>
          </>
        )}

        {/* Step 2: Column Mapping */}
        {step === "mapping" && (
          <div className="space-y-6">
            <div className="flex items-center gap-3 rounded-lg bg-muted p-3">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium">{fileName}</p>
                <p className="text-xs text-muted-foreground">{rawData.length} linhas • {headers.length} colunas</p>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Telefone <span className="text-destructive">*</span>
                </label>
                <Select value={mapping.phone} onValueChange={(v) => setMapping((m) => ({ ...m, phone: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a coluna de telefone" />
                  </SelectTrigger>
                  <SelectContent>
                    {headers.map((h) => (
                      <SelectItem key={h} value={h}>{h}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Nome</label>
                <Select value={mapping.name} onValueChange={(v) => setMapping((m) => ({ ...m, name: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a coluna de nome (opcional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Nenhum</SelectItem>
                    {headers.map((h) => (
                      <SelectItem key={h} value={h}>{h}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Email</label>
                <Select value={mapping.email} onValueChange={(v) => setMapping((m) => ({ ...m, email: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a coluna de email (opcional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Nenhum</SelectItem>
                    {headers.map((h) => (
                      <SelectItem key={h} value={h}>{h}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Preview first 5 rows */}
            <div>
              <p className="mb-2 text-sm font-medium text-muted-foreground">Preview (primeiras 5 linhas)</p>
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {headers.slice(0, 5).map((h) => (
                        <TableHead key={h} className="text-xs">{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rawData.slice(0, 5).map((row, i) => (
                      <TableRow key={i}>
                        {headers.slice(0, 5).map((h) => (
                          <TableCell key={h} className="text-xs truncate max-w-[150px]">
                            {String(row[h] || "")}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep("upload")}>Voltar</Button>
              <Button onClick={handleValidate}>Validar Dados</Button>
            </div>
          </div>
        )}

        {/* Step 3: Validation */}
        {step === "validation" && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-muted p-3 text-center">
                <p className="font-heading text-2xl font-bold">{validatedRows.length}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </div>
              <div className="rounded-lg bg-success/10 p-3 text-center">
                <p className="font-heading text-2xl font-bold text-success">{validCount}</p>
                <p className="text-xs text-muted-foreground">Válidos</p>
              </div>
              <div className="rounded-lg bg-destructive/10 p-3 text-center">
                <p className="font-heading text-2xl font-bold text-destructive">{invalidCount}</p>
                <p className="text-xs text-muted-foreground">Inválidos</p>
              </div>
            </div>

            {invalidCount > 0 && (
              <div className="flex items-start gap-2 rounded-lg bg-warning/10 p-3">
                <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                <p className="text-sm text-warning">
                  {invalidCount} contato(s) com telefone inválido serão ignorados na importação.
                </p>
              </div>
            )}

            <div className="max-h-[300px] overflow-y-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">Status</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Email</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {validatedRows.slice(0, 100).map((row, i) => (
                    <TableRow key={i} className={!row.phoneValid ? "bg-destructive/5" : ""}>
                      <TableCell>
                        {row.phoneValid ? (
                          <CheckCircle2 className="h-4 w-4 text-success" />
                        ) : (
                          <XCircle className="h-4 w-4 text-destructive" />
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.phone || "-"}
                        {row.phoneError && (
                          <span className="ml-2 text-destructive text-xs">({row.phoneError})</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{row.name || "-"}</TableCell>
                      <TableCell className="text-sm">{row.email || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {validatedRows.length > 100 && (
              <p className="text-xs text-muted-foreground text-center">
                Mostrando 100 de {validatedRows.length} registros
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep("mapping")}>Voltar</Button>
              <Button onClick={handleImport} disabled={validCount === 0}>
                Importar {validCount} contato(s)
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Importing */}
        {step === "importing" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-sm font-medium">Importando contatos...</p>
            <Progress value={importProgress} className="w-full h-3" />
            <p className="text-xs text-muted-foreground">{importProgress}%</p>
          </div>
        )}

        {/* Step 5: Done */}
        {step === "done" && (
          <div className="flex flex-col items-center gap-4 py-6">
            <CheckCircle2 className="h-16 w-16 text-success" />
            <h3 className="font-heading text-lg font-semibold">Importação Concluída!</h3>
            <div className="grid grid-cols-2 gap-4 w-full max-w-xs">
              <div className="rounded-lg bg-success/10 p-3 text-center">
                <p className="font-heading text-xl font-bold text-success">{importResult.success}</p>
                <p className="text-xs text-muted-foreground">Importados</p>
              </div>
              <div className="rounded-lg bg-destructive/10 p-3 text-center">
                <p className="font-heading text-xl font-bold text-destructive">{importResult.failed}</p>
                <p className="text-xs text-muted-foreground">Erros</p>
              </div>
            </div>
            <Button
              className="mt-2"
              onClick={() => {
                handleClose(false);
                onImportComplete();
              }}
            >
              Concluir
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ImportContactsDialog;
