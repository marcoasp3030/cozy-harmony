import { useState } from "react";
import { NODE_TYPES, getCategoryLabel, type NodeCategory } from "./nodeTypes";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Search, ChevronDown, ChevronRight, Zap, GitFork, Play } from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import { getNodeTypeConfig } from "./nodeTypes";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";

const categories: NodeCategory[] = ["trigger", "condition", "action"];

const categoryIcons: Record<NodeCategory, React.ElementType> = {
  trigger: Zap,
  condition: GitFork,
  action: Play,
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
    <div className="w-64 border-r bg-card/50 backdrop-blur-sm flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
            Componentes
          </h3>
          <Badge variant="secondary" className="text-[10px] font-normal">
            {NODE_TYPES.length} nós
          </Badge>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar componente..."
            className="h-8 text-xs pl-8 bg-background/80"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-0.5">
          {categories.map((cat) => {
            const nodes = filtered.filter((n) => n.category === cat);
            if (nodes.length === 0) return null;
            const isOpen = isSearching || !collapsed[cat];
            const CatIcon = categoryIcons[cat];

            return (
              <Collapsible key={cat} open={isOpen} onOpenChange={() => !isSearching && toggleCategory(cat)}>
                <CollapsibleTrigger className="flex items-center gap-2 w-full rounded-lg px-2.5 py-2 hover:bg-muted/60 transition-colors">
                  <CatIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex-1 text-left">
                    {getCategoryLabel(cat)}
                  </span>
                  <Badge variant="outline" className="text-[9px] h-4 px-1.5 font-normal">
                    {nodes.length}
                  </Badge>
                  {isOpen ? (
                    <ChevronDown className="h-3 w-3 text-muted-foreground/50" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                  )}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-1 pt-1 pb-2 px-0.5">
                    {nodes.map((node) => {
                      const Icon = node.icon;
                      return (
                        <div
                          key={node.type}
                          draggable
                          onDragStart={(e) => onDragStart(e, node.type)}
                          onDoubleClick={() => handleDoubleClick(node.type)}
                          className="flex items-center gap-2.5 rounded-lg border bg-card p-2.5 cursor-grab hover:shadow-md hover:border-primary/40 hover:-translate-y-px transition-all active:cursor-grabbing select-none group"
                          title={`${node.description}\n\nDuplo-clique para adicionar`}
                        >
                          <div
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-transform group-hover:scale-110"
                            style={{ backgroundColor: node.color + "15" }}
                          >
                            <Icon className="h-4 w-4" style={{ color: node.color }} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium leading-tight truncate">{node.label}</p>
                            <p className="text-[10px] text-muted-foreground leading-tight truncate mt-0.5">
                              {node.description}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
          {filtered.length === 0 && (
            <div className="flex flex-col items-center py-8 text-center">
              <Search className="h-6 w-6 text-muted-foreground/30 mb-2" />
              <p className="text-xs text-muted-foreground">Nenhum componente encontrado</p>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="p-2.5 border-t bg-muted/30">
        <p className="text-[10px] text-muted-foreground text-center">
          Arraste ou duplo-clique para adicionar ao fluxo
        </p>
      </div>
    </div>
  );
};

export default NodePalette;
