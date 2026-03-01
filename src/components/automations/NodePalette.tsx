import { useState } from "react";
import { NODE_TYPES, getCategoryLabel, type NodeCategory } from "./nodeTypes";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import { getNodeTypeConfig } from "./nodeTypes";

const categories: NodeCategory[] = ["trigger", "condition", "action"];

const NodePalette = () => {
  const [search, setSearch] = useState("");
  const { addNodes, getNodes } = useReactFlow();

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData("application/reactflow", nodeType);
    event.dataTransfer.effectAllowed = "move";
  };

  const handleDoubleClick = (nodeType: string) => {
    const config = getNodeTypeConfig(nodeType);
    if (!config) return;
    const existingNodes = getNodes();
    const lastNode = existingNodes[existingNodes.length - 1];
    const x = lastNode ? lastNode.position.x : 250;
    const y = lastNode ? lastNode.position.y + 120 : 50;

    addNodes({
      id: `${nodeType}_${Date.now()}`,
      type: "flowNode",
      position: { x, y },
      data: {
        nodeType,
        ...Object.fromEntries(config.fields.map((f) => [f.key, f.defaultValue ?? ""])),
      },
    });
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
