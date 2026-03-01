import { useState } from "react";
import { NODE_TYPES, getCategoryLabel, type NodeCategory } from "./nodeTypes";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Search, ChevronDown, ChevronRight, Zap, GitFork, Play, GripVertical } from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import { getNodeTypeConfig } from "./nodeTypes";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const categories: NodeCategory[] = ["trigger", "condition", "action"];

const categoryMeta: Record<NodeCategory, { icon: React.ElementType; gradient: string; dotColor: string }> = {
  trigger: { icon: Zap, gradient: "from-green-500/10 to-emerald-500/5", dotColor: "bg-green-500" },
  condition: { icon: GitFork, gradient: "from-amber-500/10 to-orange-500/5", dotColor: "bg-amber-500" },
  action: { icon: Play, gradient: "from-blue-500/10 to-indigo-500/5", dotColor: "bg-blue-500" },
};

const NODE_GAP_Y = 120;

const NodePalette = () => {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const { addNodes, addEdges, getNodes, fitView } = useReactFlow();

  const toggleCategory = (cat: string) =>
    setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] }));

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData("application/reactflow", nodeType);
    event.dataTransfer.effectAllowed = "move";
  };

  const findBottomNode = () => {
    const existingNodes = getNodes();
    if (existingNodes.length === 0) return null;
    let bottomNode = existingNodes[0];
    for (const n of existingNodes) {
      if (n.position.y > bottomNode.position.y) bottomNode = n;
    }
    return bottomNode;
  };

  const handleDoubleClick = (nodeType: string) => {
    const config = getNodeTypeConfig(nodeType);
    if (!config) return;

    const bottomNode = findBottomNode();
    const position = bottomNode
      ? { x: bottomNode.position.x, y: bottomNode.position.y + NODE_GAP_Y }
      : { x: 250, y: 50 };

    const newId = `${nodeType}_${Date.now()}`;

    addNodes({
      id: newId,
      type: "flowNode",
      position,
      selected: true,
      data: {
        nodeType,
        ...Object.fromEntries(config.fields.map((f) => [f.key, f.defaultValue ?? ""])),
      },
    });

    if (bottomNode) {
      addEdges({
        id: `e_${bottomNode.id}_${newId}`,
        source: bottomNode.id,
        target: newId,
        animated: true,
        style: { strokeWidth: 2, stroke: "hsl(var(--primary))" },
        markerEnd: { type: "arrowclosed" as any, color: "hsl(var(--primary))" },
      });
    }

    setTimeout(() => {
      fitView({ nodes: [{ id: newId }], padding: 0.5, duration: 300 });
    }, 50);
  };

  const filtered = search.trim()
    ? NODE_TYPES.filter(
        (n) =>
          n.label.toLowerCase().includes(search.toLowerCase()) ||
          n.description.toLowerCase().includes(search.toLowerCase())
      )
    : NODE_TYPES;

  const isSearching = search.trim().length > 0;

  return (
    <div className="w-[272px] border-r bg-gradient-to-b from-card to-card/80 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
            <Zap className="h-3.5 w-3.5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground leading-none">Componentes</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">{NODE_TYPES.length} disponíveis</p>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar componente..."
            className="h-9 text-xs pl-8 bg-background/60 border-muted focus:bg-background transition-colors"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {categories.map((cat) => {
            const nodes = filtered.filter((n) => n.category === cat);
            if (nodes.length === 0) return null;
            const isOpen = isSearching || !collapsed[cat];
            const meta = categoryMeta[cat];
            const CatIcon = meta.icon;

            return (
              <div key={cat} className="rounded-xl overflow-hidden">
                <Collapsible open={isOpen} onOpenChange={() => !isSearching && toggleCategory(cat)}>
                  <CollapsibleTrigger className={`flex items-center gap-2 w-full rounded-xl px-3 py-2.5 bg-gradient-to-r ${meta.gradient} hover:opacity-80 transition-opacity`}>
                    <span className={`h-2 w-2 rounded-full ${meta.dotColor}`} />
                    <span className="text-[11px] font-bold uppercase tracking-widest text-foreground/70 flex-1 text-left">
                      {getCategoryLabel(cat)}
                    </span>
                    <span className="text-[10px] text-muted-foreground mr-1 tabular-nums">{nodes.length}</span>
                    {isOpen ? (
                      <ChevronDown className="h-3 w-3 text-muted-foreground/60" />
                    ) : (
                      <ChevronRight className="h-3 w-3 text-muted-foreground/60" />
                    )}
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="space-y-1.5 pt-2 pb-1">
                      {nodes.map((node) => {
                        const Icon = node.icon;
                        return (
                          <Tooltip key={node.type}>
                            <TooltipTrigger asChild>
                              <div
                                draggable
                                onDragStart={(e) => onDragStart(e, node.type)}
                                onDoubleClick={() => handleDoubleClick(node.type)}
                                className="flex items-center gap-2.5 rounded-xl border bg-card/80 backdrop-blur-sm px-3 py-2.5 cursor-grab hover:shadow-lg hover:border-primary/40 hover:-translate-y-0.5 hover:bg-card transition-all duration-200 active:cursor-grabbing active:scale-[0.98] select-none group"
                              >
                                <div
                                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all duration-200 group-hover:scale-110 group-hover:shadow-md"
                                  style={{ backgroundColor: node.color + "15", boxShadow: `0 0 0 0px ${node.color}20` }}
                                >
                                  <Icon className="h-4 w-4 transition-transform" style={{ color: node.color }} />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[11px] font-semibold leading-tight truncate text-foreground/90">{node.label}</p>
                                  <p className="text-[10px] text-muted-foreground leading-tight truncate mt-0.5">
                                    {node.description}
                                  </p>
                                </div>
                                <GripVertical className="h-3.5 w-3.5 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="text-xs max-w-[200px]">
                              <p className="font-semibold">{node.label}</p>
                              <p className="text-muted-foreground mt-0.5">{node.description}</p>
                              <p className="text-primary mt-1 text-[10px]">Duplo-clique ou arraste</p>
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="flex flex-col items-center py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted mb-3">
                <Search className="h-5 w-5 text-muted-foreground/40" />
              </div>
              <p className="text-xs font-medium text-muted-foreground">Nenhum componente encontrado</p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">Tente outro termo de busca</p>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="p-3 border-t bg-muted/20">
        <div className="flex items-center justify-center gap-2 text-[10px] text-muted-foreground">
          <kbd className="px-1.5 py-0.5 rounded bg-muted text-[9px] font-mono border">Arraste</kbd>
          <span>ou</span>
          <kbd className="px-1.5 py-0.5 rounded bg-muted text-[9px] font-mono border">Duplo-clique</kbd>
          <span>para adicionar</span>
        </div>
      </div>
    </div>
  );
};

export default NodePalette;
