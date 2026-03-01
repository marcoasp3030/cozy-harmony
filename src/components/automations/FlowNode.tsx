import { memo, useState } from "react";
import { Handle, Position, type NodeProps, useReactFlow } from "@xyflow/react";
import { getNodeTypeConfig } from "./nodeTypes";
import { GripVertical, Trash2, Copy, Plus, Pencil, Unlink, MessageSquare, Image, Mic, AudioLines, Eye, Settings2 } from "lucide-react";
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
  const hasConfig = config.fields.some((f) => (data as Record<string, any>)[f.key]);

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
    const currentNode = getNode(id);
    if (currentNode) {
      window.dispatchEvent(new CustomEvent("flow-edit-node", { detail: { nodeId: id } }));
    }
  };

  // LLM model badge info
  const getModelBadge = () => {
    if (data.nodeType !== "action_llm_reply" || !data.model) return null;
    const model = data.model as string;
    if (model.startsWith("whisper")) return { label: "Transcrição", icon: Mic, cls: "bg-amber-500/15 text-amber-600 border-amber-500/30" };
    if (model.startsWith("dall-e") || model === "imagen-3") return { label: "Imagem", icon: Image, cls: "bg-pink-500/15 text-pink-600 border-pink-500/30" };
    if (model.startsWith("tts-")) return { label: "Áudio", icon: AudioLines, cls: "bg-teal-500/15 text-teal-600 border-teal-500/30" };
    if (model === "gemini-pro-vision") return { label: "Visão", icon: Eye, cls: "bg-indigo-500/15 text-indigo-600 border-indigo-500/30" };
    return { label: "Chat", icon: MessageSquare, cls: "bg-primary/10 text-primary border-primary/30" };
  };

  const modelBadge = getModelBadge();

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={`relative rounded-2xl bg-card shadow-md transition-all duration-200 min-w-[210px] max-w-[260px] group overflow-visible ${
            selected
              ? "ring-2 ring-primary/60 ring-offset-2 ring-offset-background shadow-xl scale-[1.02]"
              : "hover:shadow-lg"
          }`}
          style={{ border: `2px solid ${config.color}40` }}
          onMouseEnter={() => setShowActions(true)}
          onMouseLeave={() => setShowActions(false)}
        >
          {/* Target handle (top) */}
          {!isTrigger && (
            <Handle
              type="target"
              position={Position.Top}
              className="!w-3.5 !h-3.5 !border-[2.5px] !border-background !-top-[7px] !rounded-full transition-all hover:!scale-125"
              style={{ backgroundColor: config.color }}
            />
          )}

          {/* Quick action buttons */}
          {showActions && (
            <div className="absolute -top-10 right-1 flex items-center gap-1 z-20 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <button
                onClick={(e) => handleDuplicate(e)}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-card/95 backdrop-blur border shadow-lg hover:bg-muted hover:scale-110 transition-all"
                title="Duplicar"
              >
                <Copy className="h-3 w-3 text-muted-foreground" />
              </button>
              <button
                onClick={(e) => handleAddBelow(e)}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-card/95 backdrop-blur border shadow-lg hover:bg-primary/10 hover:scale-110 transition-all"
                title="Adicionar abaixo"
              >
                <Plus className="h-3 w-3 text-primary" />
              </button>
              {!isTrigger && (
                <button
                  onClick={(e) => handleDelete(e)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-card/95 backdrop-blur border shadow-lg hover:bg-destructive/10 hover:scale-110 transition-all"
                  title="Excluir"
                >
                  <Trash2 className="h-3 w-3 text-destructive" />
                </button>
              )}
            </div>
          )}

          {/* Header */}
          <div
            className="flex items-center gap-2 rounded-t-[14px] px-3 py-2.5"
            style={{ background: `linear-gradient(135deg, ${config.color}15, ${config.color}08)` }}
          >
            <GripVertical className="h-3 w-3 text-muted-foreground/30 cursor-grab active:cursor-grabbing" />
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg shadow-sm"
              style={{ backgroundColor: config.color + "22", border: `1px solid ${config.color}30` }}
            >
              <Icon className="h-3.5 w-3.5" style={{ color: config.color }} />
            </div>
            <span className="text-[11px] font-bold truncate flex-1" style={{ color: config.color }}>
              {config.label}
            </span>
            {isTrigger && (
              <span className="flex h-2 w-2 rounded-full bg-green-500 animate-pulse" title="Gatilho" />
            )}
          </div>

          {/* Body */}
          <div className="px-3 py-2 space-y-1.5 min-h-[32px]">
            {/* LLM model badge */}
            {modelBadge && (() => {
              const BadgeIcon = modelBadge.icon;
              return (
                <Badge variant="outline" className={`text-[9px] gap-1 px-1.5 py-0.5 font-medium border ${modelBadge.cls}`}>
                  <BadgeIcon className="h-2.5 w-2.5" />
                  {modelBadge.label}
                </Badge>
              );
            })()}

            {/* Configured fields preview */}
            {config.fields.slice(0, 2).map((field) => {
              const val = (data as Record<string, any>)[field.key];
              if (!val) return null;
              return (
                <div key={field.key} className="text-[10px] text-muted-foreground truncate leading-relaxed">
                  <span className="font-semibold text-foreground/60">{field.label}:</span>{" "}
                  <span className="text-foreground/80">{String(val).slice(0, 35)}</span>
                </div>
              );
            })}

            {/* Unconfigured hint */}
            {config.fields.length > 0 && !hasConfig && (
              <div className="flex items-center gap-1.5 py-0.5">
                <Settings2 className="h-3 w-3 text-muted-foreground/40" />
                <p className="text-[10px] text-muted-foreground/50 italic">Clique para configurar</p>
              </div>
            )}
          </div>

          {/* Source handle (bottom) */}
          <Handle
            type="source"
            position={Position.Bottom}
            className="!w-3.5 !h-3.5 !border-[2.5px] !border-background !-bottom-[7px] !rounded-full transition-all hover:!scale-125"
            style={{ backgroundColor: config.color }}
          />

          {/* Condition: extra handles for yes/no */}
          {isCondition && (
            <>
              <Handle
                type="source"
                position={Position.Right}
                id="yes"
                className="!w-3 !h-3 !border-2 !border-background !-right-1.5 !rounded-full"
                style={{ backgroundColor: "#22c55e", top: "60%" }}
              />
              <Handle
                type="source"
                position={Position.Left}
                id="no"
                className="!w-3 !h-3 !border-2 !border-background !-left-1.5 !rounded-full"
                style={{ backgroundColor: "#ef4444", top: "60%" }}
              />
              <div className="absolute -right-8 text-[8px] font-bold tracking-wide" style={{ top: "56%", color: "#22c55e" }}>SIM</div>
              <div className="absolute -left-9 text-[8px] font-bold tracking-wide" style={{ top: "56%", color: "#ef4444" }}>NÃO</div>
            </>
          )}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-48 rounded-xl">
        <ContextMenuItem onClick={handleEdit} className="gap-2 cursor-pointer rounded-lg">
          <Pencil className="h-3.5 w-3.5" />
          Editar configuração
        </ContextMenuItem>
        <ContextMenuItem onClick={() => handleDuplicate()} className="gap-2 cursor-pointer rounded-lg">
          <Copy className="h-3.5 w-3.5" />
          Duplicar nó
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleDisconnect} className="gap-2 cursor-pointer rounded-lg">
          <Unlink className="h-3.5 w-3.5" />
          Desconectar arestas
        </ContextMenuItem>
        {!isTrigger && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => handleDelete()}
              className="gap-2 cursor-pointer text-destructive focus:text-destructive rounded-lg"
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
