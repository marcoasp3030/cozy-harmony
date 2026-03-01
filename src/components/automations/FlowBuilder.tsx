import { useState, useCallback, useRef, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  BackgroundVariant,
  MarkerType,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import FlowNode from "./FlowNode";
import NodePalette from "./NodePalette";
import NodeConfigPanel from "./NodeConfigPanel";
import { getNodeTypeConfig } from "./nodeTypes";
import { Button } from "@/components/ui/button";
import { Save, Undo2, Redo2, Trash2 } from "lucide-react";
import { toast } from "sonner";

const customNodeTypes = { flowNode: FlowNode };

const defaultEdgeOptions = {
  animated: true,
  style: { strokeWidth: 2, stroke: "hsl(var(--primary))" },
  markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--primary))" },
};

interface FlowBuilderProps {
  initialNodes?: Node[];
  initialEdges?: Edge[];
  onSave: (nodes: Node[], edges: Edge[]) => void;
}

// Max undo/redo history
const MAX_HISTORY = 30;

const FlowBuilderInner = ({ initialNodes = [], initialEdges = [], onSave }: FlowBuilderProps) => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
  const { deleteElements } = useReactFlow();

  // Undo/redo
  const [history, setHistory] = useState<{ nodes: Node[]; edges: Edge[] }[]>([
    { nodes: initialNodes, edges: initialEdges },
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const isUndoRedoing = useRef(false);

  // Save state to history on changes (debounced)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (isUndoRedoing.current) {
      isUndoRedoing.current = false;
      return;
    }
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      setHistory((prev) => {
        const trimmed = prev.slice(0, historyIndex + 1);
        const newHistory = [...trimmed, { nodes: [...nodes], edges: [...edges] }];
        if (newHistory.length > MAX_HISTORY) newHistory.shift();
        return newHistory;
      });
      setHistoryIndex((prev) => Math.min(prev + 1, MAX_HISTORY - 1));
    }, 500);
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    const state = history[newIndex];
    if (!state) return;
    isUndoRedoing.current = true;
    setNodes(state.nodes);
    setEdges(state.edges);
    setHistoryIndex(newIndex);
    setSelectedNode(null);
  }, [historyIndex, history, setNodes, setEdges]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const newIndex = historyIndex + 1;
    const state = history[newIndex];
    if (!state) return;
    isUndoRedoing.current = true;
    setNodes(state.nodes);
    setEdges(state.edges);
    setHistoryIndex(newIndex);
    setSelectedNode(null);
  }, [historyIndex, history, setNodes, setEdges]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        onSave(nodes, edges);
        toast.success("Fluxo salvo!");
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedNode && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
          const cfg = getNodeTypeConfig(selectedNode.data?.nodeType as string);
          if (cfg?.category !== "trigger") {
            deleteElements({ nodes: [{ id: selectedNode.id }] });
            setSelectedNode(null);
          }
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, onSave, nodes, edges, selectedNode, deleteElements]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, ...defaultEdgeOptions }, eds)),
    [setEdges]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const nodeType = event.dataTransfer.getData("application/reactflow");
      if (!nodeType || !reactFlowInstance || !reactFlowWrapper.current) return;

      const config = getNodeTypeConfig(nodeType);
      if (!config) return;

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });

      const newNode: Node = {
        id: `${nodeType}_${Date.now()}`,
        type: "flowNode",
        position,
        data: {
          nodeType,
          ...Object.fromEntries(config.fields.map((f) => [f.key, f.defaultValue ?? ""])),
        },
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [reactFlowInstance, setNodes]
  );

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const updateNodeData = useCallback(
    (id: string, data: Record<string, any>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === id ? { ...n, data } : n))
      );
      setSelectedNode((prev) => (prev?.id === id ? { ...prev, data } : prev));
    },
    [setNodes]
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== id));
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      setSelectedNode(null);
    },
    [setNodes, setEdges]
  );

  const deleteSelectedNodes = useCallback(() => {
    const selected = nodes.filter((n) => n.selected);
    const triggerIds = selected
      .filter((n) => getNodeTypeConfig(n.data?.nodeType as string)?.category === "trigger")
      .map((n) => n.id);
    const toDelete = selected.filter((n) => !triggerIds.includes(n.id));
    if (toDelete.length === 0) return;
    deleteElements({ nodes: toDelete.map((n) => ({ id: n.id })) });
    setSelectedNode(null);
    toast.info(`${toDelete.length} nó(s) removido(s)`);
  }, [nodes, deleteElements]);

  const handleSave = useCallback(() => {
    onSave(nodes, edges);
  }, [nodes, edges, onSave]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;
  const selectedCount = nodes.filter((n) => n.selected).length;

  return (
    <div className="flex h-full border rounded-lg overflow-hidden bg-background">
      <NodePalette />

      <div className="flex-1 relative" ref={reactFlowWrapper}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onInit={setReactFlowInstance}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          nodeTypes={customNodeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          fitView
          snapToGrid
          snapGrid={[16, 16]}
          deleteKeyCode={null}
          multiSelectionKeyCode="Shift"
          selectionOnDrag
          panOnDrag={[1, 2]}
          className="bg-muted/20"
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} className="opacity-30" />
          <Controls className="!bg-card !border !shadow-md" />
          <MiniMap
            className="!bg-card !border !shadow-md"
            nodeColor={(n) => {
              const cfg = getNodeTypeConfig(n.data?.nodeType as string);
              return cfg?.color || "#888";
            }}
            maskColor="hsl(var(--background) / 0.7)"
          />
        </ReactFlow>

        {/* Toolbar floating top-right */}
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={undo}
            disabled={!canUndo}
            title="Desfazer (Ctrl+Z)"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={redo}
            disabled={!canRedo}
            title="Refazer (Ctrl+Y)"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
          {selectedCount > 1 && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1 text-xs text-destructive hover:text-destructive"
              onClick={deleteSelectedNodes}
              title="Excluir selecionados"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {selectedCount}
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleSave}
            className="h-8 gap-1.5 text-xs font-semibold shadow-lg"
            title="Salvar (Ctrl+S)"
          >
            <Save className="h-3.5 w-3.5" />
            Salvar
          </Button>
        </div>

        {/* Hints bar */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 bg-card/90 backdrop-blur-sm border rounded-full px-4 py-1.5 shadow-md">
          <span className="text-[10px] text-muted-foreground">
            <kbd className="px-1 py-0.5 rounded bg-muted text-[9px] font-mono">Ctrl+Z</kbd> Desfazer
          </span>
          <span className="text-[10px] text-muted-foreground">
            <kbd className="px-1 py-0.5 rounded bg-muted text-[9px] font-mono">Del</kbd> Excluir
          </span>
          <span className="text-[10px] text-muted-foreground">
            <kbd className="px-1 py-0.5 rounded bg-muted text-[9px] font-mono">Ctrl+S</kbd> Salvar
          </span>
          <span className="text-[10px] text-muted-foreground">
            <kbd className="px-1 py-0.5 rounded bg-muted text-[9px] font-mono">Shift</kbd> Multi-selecionar
          </span>
        </div>
      </div>

      {selectedNode && (
        <NodeConfigPanel
          node={selectedNode}
          onUpdate={updateNodeData}
          onClose={() => setSelectedNode(null)}
          onDelete={deleteNode}
        />
      )}
    </div>
  );
};

const FlowBuilder = (props: FlowBuilderProps) => (
  <ReactFlowProvider>
    <FlowBuilderInner {...props} />
  </ReactFlowProvider>
);

export default FlowBuilder;
