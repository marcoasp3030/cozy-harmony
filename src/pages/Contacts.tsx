import { useState } from "react";
import { Plus, Upload, Search, MoreHorizontal, Tag, Trash2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const mockContacts = [
  { id: "1", name: "João Silva", phone: "5511999990001", tags: ["Cliente", "VIP"], lastMessage: "2 horas atrás" },
  { id: "2", name: "Maria Santos", phone: "5511999990002", tags: ["Lead"], lastMessage: "1 dia atrás" },
  { id: "3", name: "Pedro Oliveira", phone: "5511999990003", tags: ["Cliente"], lastMessage: "3 dias atrás" },
  { id: "4", name: "Ana Costa", phone: "5511999990004", tags: ["Prospect", "Quente"], lastMessage: "5 horas atrás" },
  { id: "5", name: "Carlos Lima", phone: "5511999990005", tags: ["Cliente"], lastMessage: "1 semana atrás" },
];

const formatPhone = (phone: string) => {
  const match = phone.match(/^(\d{2})(\d{2})(\d{5})(\d{4})$/);
  if (match) return `+${match[1]} (${match[2]}) ${match[3]}-${match[4]}`;
  return phone;
};

const tagColors: Record<string, string> = {
  Cliente: "bg-primary/15 text-primary",
  VIP: "bg-warning/15 text-warning",
  Lead: "bg-info/15 text-info",
  Prospect: "bg-secondary/15 text-secondary",
  Quente: "bg-destructive/15 text-destructive",
};

const Contacts = () => {
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  const toggleSelect = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    setSelected(selected.length === mockContacts.length ? [] : mockContacts.map((c) => c.id));
  };

  const filtered = mockContacts.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">Contatos</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie seus contatos e listas
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Upload className="mr-2 h-4 w-4" />
            Importar
          </Button>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Novo Contato
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="relative w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome ou telefone..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {selected.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {selected.length} selecionado(s)
                </span>
                <Button size="sm" variant="outline">
                  <Tag className="mr-1 h-3 w-3" />
                  Tag
                </Button>
                <Button size="sm" variant="outline">
                  <Send className="mr-1 h-3 w-3" />
                  Campanha
                </Button>
                <Button size="sm" variant="destructive">
                  <Trash2 className="mr-1 h-3 w-3" />
                  Excluir
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox
                    checked={selected.length === mockContacts.length}
                    onCheckedChange={toggleAll}
                  />
                </TableHead>
                <TableHead>Contato</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Última Mensagem</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell>
                    <Checkbox
                      checked={selected.includes(contact.id)}
                      onCheckedChange={() => toggleSelect(contact.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs">
                          {contact.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")
                            .slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{contact.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {formatPhone(contact.phone)}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {contact.tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className={tagColors[tag] || ""}
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {contact.lastMessage}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>Ver detalhes</DropdownMenuItem>
                        <DropdownMenuItem>Enviar mensagem</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive">
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default Contacts;
