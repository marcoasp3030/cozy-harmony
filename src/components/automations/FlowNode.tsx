import { memo, useState } from "react";
import { Handle, Position, type NodeProps, useReactFlow } from "@xyflow/react";
import { getNodeTypeConfig } from "./nodeTypes";
import { GripVertical, Trash2, Copy, Plus, Pencil, Unlink, MessageSquare, Image, Mic, AudioLines, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

const FlowNode = memo(({ id, data, selected }: NodeProps) => {
  const config = getNodeTypeConfig(data.nodeType as string);
  const [showActions, setShowActions] = useState(false);
  const { deleteElements, addNodes, addEdges, getNode, getEdges, setEdges, fitView } = useReactFlow();

  if (!config) return null;

  const Icon = config.icon;
  const isTrigger = config.category === "trigger";
  const isCondition = config.category === "condition";

  const handleDelete = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (isTrigger) return;
    deleteElements({ nodes: [{ id }] });
  };

  const handleDuplicate = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const currentNode = getNode(id);
    if (!currentNode) return;
    const newId = `${data.nodeType}_${Date.now()}`;
    const newNode = {
      id: newId,
      type: "flowNode",
      position: { x: currentNode.position.x + 30, y: currentNode.position.y + 120 },
      data: { ...currentNode.data },
      selected: true,
    };
    addNodes(newNode);
    setTimeout(() => fitView({ nodes: [{ id: newId }], padding: 0.5, duration: 300 }), 50);
  };

  const handleAddBelow = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const currentNode = getNode(id);
    if (!currentNode) return;
    const newId = `action_send_message_${Date.now()}`;
    const newNode = {
      id: newId,
      type: "flowNode",
      position: { x: currentNode.position.x, y: currentNode.position.y + 140 },
      data: { nodeType: "action_send_message", message: "" },
      selected: true,
    };
    addNodes(newNode);
    addEdges({
      id: `e_${id}_${newId}`,
      source: id,
      target: newId,
      animated: true,
      style: { strokeWidth: 2, stroke: "hsl(var(--primary))" },
      markerEnd: { type: "arrowclosed" as any, color: "hsl(var(--primary))" },
    });
    setTimeout(() => fitView({ nodes: [{ id: newId }], padding: 0.5, duration: 300 }), 50);
  };

  const handleDisconnect = () => {
    const allEdges = getEdges();
    const connectedEdges = allEdges.filter((e) => e.source === id || e.target === id);
    if (connectedEdges.length === 0) return;
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
  };

  const handleEdit = () => {
    // Dispatch a custom event so FlowBuilder can open the config panel
    const currentNode = getNode(id);
    if (currentNode) {
      window.dispatchEvent(new CustomEvent("flow-edit-node", { detail: { nodeId: id } }));
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={`relative rounded-xl border-2 bg-card shadow-lg transition-all min-w-[200px] max-w-[260px] group ${
            selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
          }`}
          style={{ borderColor: config.color + "80" }}
          onMouseEnter={() => setShowActions(true)}
          onMouseLeave={() => setShowActions(false)}
        >
          {/* Target handle (top) */}
          {!isTrigger && (
            <Handle
              type="target"
              position={Position.Top}
              className="!w-3 !h-3 !border-2 !border-background !-top-1.5"
              style={{ backgroundColor: config.color }}
            />
          )}

          {/* Quick action buttons */}
          {showActions && (
            <div className="absolute -top-9 right-0 flex items-center gap-1 z-20 animate-in fade-in slide-in-from-bottom-1 duration-150">
              <button
                onClick={(e) => handleDuplicate(e)}
                className="flex h-7 w-7 items-center justify-center rounded-md bg-card border shadow-md hover:bg-muted transition-colors"
                title="Duplicar nó"
              >
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              <button
                onClick={(e) => handleAddBelow(e)}
                className="flex h-7 w-7 items-center justify-center rounded-md bg-card border shadow-md hover:bg-muted transition-colors"
                title="Adicionar nó abaixo"
              >
                <Plus className="h-3.5 w-3.5 text-primary" />
              </button>
              {!isTrigger && (
                <button
                  onClick={(e) => handleDelete(e)}
                  className="flex h-7 w-7 items-center justify-center rounded-md bg-card border shadow-md hover:bg-destructive/10 transition-colors"
                  title="Excluir nó"
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </button>
              )}
            </div>
          )}

          {/* Header */}
          <div
            className="flex items-center gap-2 rounded-t-[10px] px-3 py-2"
            style={{ backgroundColor: config.color + "18" }}
          >
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50 cursor-grab" />
            <div
              className="flex h-6 w-6 items-center justify-center rounded-md"
              style={{ backgroundColor: config.color + "30" }}
            >
              <Icon className="h-3.5 w-3.5" style={{ color: config.color }} />
            </div>
            <span className="text-xs font-semibold truncate flex-1" style={{ color: config.color }}>
              {config.label}
            </span>
          </div>

          {/* Body - show configured values */}
          <div className="px-3 py-2 space-y-1">
            {/* LLM model category badge */}
            {data.nodeType === "action_llm_reply" && data.model && (() => {
              const model = data.model as string;
              const info = model.startsWith("whisper")
                ? { label: "Transcrição", icon: Mic, cls: "bg-amber-500/15 text-amber-600 border-amber-500/30" }
                : model.startsWith("dall-e") || model === "imagen-3"
                ? { label: "Geração de Imagem", icon: Image, cls: "bg-pink-500/15 text-pink-600 border-pink-500/30" }
                : model.startsWith("tts-")
                ? { label: "Texto → Áudio", icon: AudioLines, cls: "bg-teal-500/15 text-teal-600 border-teal-500/30" }
                : model === "gemini-pro-vision"
                ? { label: "Análise Visual", icon: Eye, cls: "bg-indigo-500/15 text-indigo-600 border-indigo-500/30" }
                : { label: "Chat / Texto", icon: MessageSquare, cls: "bg-primary/10 text-primary border-primary/30" };
              const BadgeIcon = info.icon;
              return (
                <Badge variant="outline" className={`text-[9px] gap-1 px-1.5 py-0.5 font-medium border ${info.cls}`}>
                  <BadgeIcon className="h-2.5 w-2.5" />
                  {info.label}
                </Badge>
              );
            })()}
            {config.fields.slice(0, 2).map((field) => {
              const val = (data as Record<string, any>)[field.key];
              if (!val) return null;
              return (
                <div key={field.key} className="text-[10px] text-muted-foreground truncate">
                  <span className="font-medium">{field.label}:</span>{" "}
                  <span className="text-foreground/80">{String(val).slice(0, 40)}</span>
                </div>
              );
            })}
            {config.fields.length > 0 && !config.fields.some((f) => (data as Record<string, any>)[f.key]) && (
              <p className="text-[10px] text-muted-foreground/60 italic">Clique para configurar</p>
            )}
          </div>

          {/* Source handle (bottom) */}
          <Handle
            type="source"
            position={Position.Bottom}
            className="!w-3 !h-3 !border-2 !border-background !-bottom-1.5"
            style={{ backgroundColor: config.color }}
          />

          {/* Condition: extra handles for yes/no */}
          {isCondition && (
            <>
              <Handle
                type="source"
                position={Position.Right}
                id="yes"
                className="!w-2.5 !h-2.5 !border-2 !border-background !-right-1"
                style={{ backgroundColor: "#22c55e", top: "60%" }}
              />
              <Handle
                type="source"
                position={Position.Left}
                id="no"
                className="!w-2.5 !h-2.5 !border-2 !border-background !-left-1"
                style={{ backgroundColor: "#ef4444", top: "60%" }}
              />
              <div className="absolute -right-6 text-[8px] font-bold text-green-500" style={{ top: "56%" }}>Sim</div>
              <div className="absolute -left-7 text-[8px] font-bold text-red-500" style={{ top: "56%" }}>Não</div>
            </>
          )}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={handleEdit} className="gap-2 cursor-pointer">
          <Pencil className="h-3.5 w-3.5" />
          Editar configuração
        </ContextMenuItem>
        <ContextMenuItem onClick={() => handleDuplicate()} className="gap-2 cursor-pointer">
          <Copy className="h-3.5 w-3.5" />
          Duplicar nó
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleDisconnect} className="gap-2 cursor-pointer">
          <Unlink className="h-3.5 w-3.5" />
          Desconectar arestas
        </ContextMenuItem>
        {!isTrigger && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => handleDelete()}
              className="gap-2 cursor-pointer text-destructive focus:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Excluir nó
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
});

FlowNode.displayName = "FlowNode";
export default FlowNode;
