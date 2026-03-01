import { X, Copy, Trash2, Plus, Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
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
        <Button variant="outline" role="combobox" className="h-8 w-full justify-between text-xs font-normal">
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

  return (
    <div className="w-72 border-l bg-card flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b" style={{ backgroundColor: config.color + "10" }}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: config.color + "25" }}>
            <Icon className="h-4 w-4" style={{ color: config.color }} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{config.label}</p>
            <p className="text-[10px] text-muted-foreground truncate">{config.description}</p>
          </div>
        </div>
        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Fields */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          {config.fields.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              Este nó não possui configurações adicionais.
            </p>
          )}
          {config.fields.map((field) => {
            const val = (node.data as Record<string, any>)[field.key] ?? field.defaultValue ?? "";
            return (
              <div key={field.key} className="space-y-1.5">
                <Label className="text-xs">
                  {field.label}
                  {field.required && <span className="text-destructive ml-0.5">*</span>}
                </Label>
                {field.key === "tag_name" && (
                  <TagFieldCombobox value={val} onChange={(v) => updateField(field.key, v)} />
                )}
                {field.type === "text" && field.key !== "tag_name" && (
                  <Input
                    value={val}
                    onChange={(e) => updateField(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className="h-8 text-xs"
                  />
                )}
                {field.type === "textarea" && (
                  <Textarea
                    value={val}
                    onChange={(e) => updateField(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className="text-xs min-h-[80px] resize-y"
                  />
                )}
                {field.type === "number" && (
                  <Input
                    type="number"
                    value={val}
                    onChange={(e) => updateField(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className="h-8 text-xs"
                  />
                )}
                {field.type === "select" && (
                  <Select value={val} onValueChange={(v) => updateField(field.key, v)}>
                    <SelectTrigger className="h-8 text-xs">
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
                  <Switch checked={!!val} onCheckedChange={(v) => updateField(field.key, v)} />
                )}
              </div>
            );
          })}

          {/* Variables hint for text/textarea fields */}
          {config.fields.some((f) => f.type === "textarea" || f.type === "text") && (
            <div className="rounded-md bg-muted/50 p-2">
              <p className="text-[10px] font-medium text-muted-foreground mb-1">Variáveis disponíveis:</p>
              <div className="flex flex-wrap gap-1">
                {["{{nome}}", "{{phone}}", "{{mensagem}}", "{{transcricao}}"].map((v) => (
                  <button
                    key={v}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-mono hover:bg-primary/20 transition-colors"
                    onClick={() => {
                      // Copy to clipboard
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
      <div className="p-3 border-t flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs gap-1"
          onClick={handleDuplicate}
        >
          <Copy className="h-3.5 w-3.5" />
          Duplicar
        </Button>
        {!isTrigger && (
          <Button
            variant="destructive"
            size="sm"
            className="flex-1 text-xs gap-1"
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
