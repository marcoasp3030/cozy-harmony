import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getNodeTypeConfig } from "./nodeTypes";
import type { Node } from "@xyflow/react";

interface NodeConfigPanelProps {
  node: Node;
  onUpdate: (id: string, data: Record<string, any>) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
}

const NodeConfigPanel = ({ node, onUpdate, onClose, onDelete }: NodeConfigPanelProps) => {
  const config = getNodeTypeConfig(node.data.nodeType as string);
  if (!config) return null;

  const Icon = config.icon;

  const updateField = (key: string, value: any) => {
    onUpdate(node.id, { ...node.data, [key]: value });
  };

  return (
    <div className="w-72 border-l bg-card flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b" style={{ backgroundColor: config.color + "10" }}>
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md" style={{ backgroundColor: config.color + "25" }}>
            <Icon className="h-4 w-4" style={{ color: config.color }} />
          </div>
          <div>
            <p className="text-sm font-semibold">{config.label}</p>
            <p className="text-[10px] text-muted-foreground">{config.description}</p>
          </div>
        </div>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose}>
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
                {field.type === "text" && (
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
        </div>
      </ScrollArea>

      {/* Actions */}
      <div className="p-3 border-t">
        <Button
          variant="destructive"
          size="sm"
          className="w-full text-xs"
          onClick={() => onDelete(node.id)}
        >
          Remover Nó
        </Button>
      </div>
    </div>
  );
};

export default NodeConfigPanel;
