import { useState } from "react";
import { NODE_TYPES, getCategoryLabel, type NodeCategory } from "./nodeTypes";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import { getNodeTypeConfig } from "./nodeTypes";

const categories: NodeCategory[] = ["trigger", "condition", "action"];

const NODE_WIDTH = 230;
const NODE_GAP_Y = 120;

const NodePalette = () => {
  const [search, setSearch] = useState("");
  const { addNodes, addEdges, getNodes, getEdges, fitView } = useReactFlow();

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

    // Auto-connect to the bottom node if it exists
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

  return (
    <div className="w-56 border-r bg-muted/30 flex flex-col h-full">
      <div className="p-3 border-b space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Componentes
        </h3>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar nó..."
            className="h-7 text-xs pl-7"
          />
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-4">
          {categories.map((cat) => {
            const nodes = filtered.filter((n) => n.category === cat);
            if (nodes.length === 0) return null;
            return (
              <div key={cat}>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
                  {getCategoryLabel(cat)}
                </p>
                <div className="space-y-1">
                  {nodes.map((node) => {
                    const Icon = node.icon;
                    return (
                      <div
                        key={node.type}
                        draggable
                        onDragStart={(e) => onDragStart(e, node.type)}
                        onDoubleClick={() => handleDoubleClick(node.type)}
                        className="flex items-center gap-2 rounded-lg border bg-card p-2 cursor-grab hover:shadow-md hover:border-primary/30 transition-all active:cursor-grabbing select-none"
                        title={`${node.description}\n\nDuplo-clique para adicionar`}
                      >
                        <div
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                          style={{ backgroundColor: node.color + "20" }}
                        >
                          <Icon className="h-3.5 w-3.5" style={{ color: node.color }} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-medium leading-tight truncate">{node.label}</p>
                          <p className="text-[9px] text-muted-foreground leading-tight truncate">
                            {node.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">Nenhum nó encontrado</p>
          )}
        </div>
      </ScrollArea>
      <div className="p-2 border-t">
        <p className="text-[9px] text-muted-foreground text-center">
          Arraste ou duplo-clique para adicionar
        </p>
      </div>
    </div>
  );
};

export default NodePalette;
