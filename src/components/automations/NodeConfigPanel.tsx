import { X, Copy, Trash2, Plus, Check, ChevronsUpDown, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getNodeTypeConfig } from "./nodeTypes";
import { useReactFlow, type Node } from "@xyflow/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface NodeConfigPanelProps {
  node: Node;
  onUpdate: (id: string, data: Record<string, any>) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
}

const TagFieldCombobox = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
  const [open, setOpen] = useState(false);
  const [newTag, setNewTag] = useState("");
  const queryClient = useQueryClient();

  const { data: tags = [] } = useQuery({
    queryKey: ["tags"],
    queryFn: async () => {
      const { data } = await supabase.from("tags").select("id, name, color").order("name");
      return data || [];
    },
  });

  const handleCreateTag = async () => {
    if (!newTag.trim()) return;
    const { error } = await supabase.from("tags").insert({ name: newTag.trim() });
    if (error) { toast.error("Erro ao criar tag"); return; }
    queryClient.invalidateQueries({ queryKey: ["tags"] });
    onChange(newTag.trim());
    setNewTag("");
    toast.success("Tag criada!");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="h-9 w-full justify-between text-xs font-normal rounded-lg">
          {value ? (
            <span className="flex items-center gap-1.5">
              {(() => { const t = tags.find(t => t.name === value); return t ? <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} /> : null; })()}
              {value}
            </span>
          ) : "Selecione uma tag..."}
          <ChevronsUpDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar tag..." className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty className="py-2 text-center text-xs">
              Nenhuma tag encontrada.
            </CommandEmpty>
            <CommandGroup heading="Tags existentes">
              {tags.map((tag) => (
                <CommandItem
                  key={tag.id}
                  value={tag.name}
                  onSelect={() => { onChange(tag.name); setOpen(false); }}
                  className="text-xs gap-2"
                >
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                  {tag.name}
                  <Check className={cn("ml-auto h-3 w-3", value === tag.name ? "opacity-100" : "opacity-0")} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          <div className="border-t p-2 flex gap-1">
            <Input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="Nova tag..."
              className="h-7 text-xs flex-1"
              onKeyDown={(e) => e.key === "Enter" && handleCreateTag()}
            />
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={handleCreateTag} disabled={!newTag.trim()}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

const NodeConfigPanel = ({ node, onUpdate, onClose, onDelete }: NodeConfigPanelProps) => {
  const config = getNodeTypeConfig(node.data.nodeType as string);
  const { addNodes, getNode } = useReactFlow();

  if (!config) return null;

  const Icon = config.icon;
  const isTrigger = config.category === "trigger";

  const updateField = (key: string, value: any) => {
    onUpdate(node.id, { ...node.data, [key]: value });
  };

  const handleDuplicate = () => {
    const currentNode = getNode(node.id);
    if (!currentNode) return;
    addNodes({
      id: `${node.data.nodeType}_${Date.now()}`,
      type: "flowNode",
      position: { x: currentNode.position.x + 30, y: currentNode.position.y + 80 },
      data: { ...currentNode.data },
    });
    toast.info("Nó duplicado");
  };

  const filledCount = config.fields.filter(f => (node.data as Record<string, any>)[f.key]).length;
  const requiredCount = config.fields.filter(f => f.required).length;
  const filledRequired = config.fields.filter(f => f.required && (node.data as Record<string, any>)[f.key]).length;

  return (
    <div className="w-80 border-l bg-card/95 backdrop-blur-sm flex flex-col h-full shadow-lg">
      {/* Header */}
      <div
        className="p-4 border-b"
        style={{ background: `linear-gradient(135deg, ${config.color}12, ${config.color}05)` }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm"
              style={{ backgroundColor: config.color + "20", border: `1px solid ${config.color}30` }}
            >
              <Icon className="h-5 w-5" style={{ color: config.color }} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold truncate">{config.label}</p>
              <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{config.description}</p>
            </div>
          </div>
          <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 rounded-lg hover:bg-background/80" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Progress indicator */}
        {config.fields.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${config.fields.length > 0 ? (filledCount / config.fields.length) * 100 : 0}%`,
                  backgroundColor: filledRequired < requiredCount ? "#f59e0b" : config.color,
                }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {filledCount}/{config.fields.length}
            </span>
          </div>
        )}
      </div>

      {/* Fields */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {config.fields.length === 0 && (
            <div className="flex flex-col items-center py-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted mb-3">
                <Icon className="h-5 w-5 text-muted-foreground/50" />
              </div>
              <p className="text-xs text-muted-foreground">
                Este nó não possui configurações adicionais.
              </p>
              <p className="text-[10px] text-muted-foreground/60 mt-1">
                Ele funcionará automaticamente no fluxo.
              </p>
            </div>
          )}
          {config.fields.map((field, idx) => {
            const val = (node.data as Record<string, any>)[field.key] ?? field.defaultValue ?? "";
            const isFilled = !!val && val !== "";
            return (
              <div key={field.key}>
                {idx > 0 && <Separator className="mb-4" />}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold flex items-center gap-1.5">
                      {field.label}
                      {field.required && (
                        <span className="text-[9px] text-destructive font-bold">*</span>
                      )}
                    </Label>
                    {isFilled && (
                      <Check className="h-3 w-3 text-green-500" />
                    )}
                  </div>
                  {field.key === "tag_name" && (
                    <TagFieldCombobox value={val} onChange={(v) => updateField(field.key, v)} />
                  )}
                  {field.type === "text" && field.key !== "tag_name" && (
                    <Input
                      value={val}
                      onChange={(e) => updateField(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className="h-9 text-xs rounded-lg"
                    />
                  )}
                  {field.type === "textarea" && (
                    <Textarea
                      value={val}
                      onChange={(e) => updateField(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className="text-xs min-h-[90px] resize-y rounded-lg"
                    />
                  )}
                  {field.type === "number" && (
                    <Input
                      type="number"
                      value={val}
                      onChange={(e) => updateField(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className="h-9 text-xs rounded-lg"
                    />
                  )}
                  {field.type === "select" && (
                    <Select value={val} onValueChange={(v) => updateField(field.key, v)}>
                      <SelectTrigger className="h-9 text-xs rounded-lg">
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                      <SelectContent>
                        {field.options?.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value} className="text-xs">
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {field.type === "switch" && (
                    <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
                      <span className="text-[11px] text-muted-foreground">{val ? "Ativado" : "Desativado"}</span>
                      <Switch checked={!!val} onCheckedChange={(v) => updateField(field.key, v)} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Variables hint */}
          {config.fields.some((f) => f.type === "textarea" || f.type === "text") && (
            <div className="rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/10 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Sparkles className="h-3 w-3 text-primary" />
                <p className="text-[10px] font-semibold text-primary">Variáveis disponíveis</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {["{{nome}}", "{{phone}}", "{{mensagem}}", "{{transcricao}}"].map((v) => (
                  <button
                    key={v}
                    className="text-[9px] px-2 py-1 rounded-md bg-card border border-primary/20 text-primary font-mono hover:bg-primary/10 hover:border-primary/30 transition-all active:scale-95"
                    onClick={() => {
                      navigator.clipboard.writeText(v);
                      toast.info(`${v} copiado!`);
                    }}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Actions */}
      <div className="p-3 border-t bg-muted/20 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs gap-1.5 rounded-lg h-9"
          onClick={handleDuplicate}
        >
          <Copy className="h-3.5 w-3.5" />
          Duplicar
        </Button>
        {!isTrigger && (
          <Button
            variant="destructive"
            size="sm"
            className="flex-1 text-xs gap-1.5 rounded-lg h-9"
            onClick={() => onDelete(node.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Excluir
          </Button>
        )}
      </div>
    </div>
  );
};

export default NodeConfigPanel;
