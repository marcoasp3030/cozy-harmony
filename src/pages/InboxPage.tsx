import { Search, Send, Paperclip, Smile } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useState } from "react";

const mockChats = [
  { id: "1", name: "João Silva", lastMsg: "Olá, quero saber sobre o plano", time: "14:32", unread: 3, status: "open" },
  { id: "2", name: "Maria Santos", lastMsg: "Obrigada pela informação!", time: "13:10", unread: 0, status: "resolved" },
  { id: "3", name: "Pedro Oliveira", lastMsg: "Quanto custa?", time: "12:45", unread: 1, status: "open" },
  { id: "4", name: "Ana Costa", lastMsg: "Pode me enviar o catálogo?", time: "11:20", unread: 2, status: "waiting" },
];

const mockMessages = [
  { id: "1", text: "Olá, quero saber sobre o plano", from: "contact", time: "14:30" },
  { id: "2", text: "Olá João! Claro, temos vários planos disponíveis.", from: "me", time: "14:31" },
  { id: "3", text: "Qual seria o melhor para uma empresa pequena?", from: "contact", time: "14:32" },
];

const InboxPage = () => {
  const [selectedChat, setSelectedChat] = useState("1");
  const [message, setMessage] = useState("");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-bold">Inbox</h1>
        <p className="text-sm text-muted-foreground">Atenda seus clientes em tempo real</p>
      </div>

      <div className="grid h-[calc(100vh-220px)] grid-cols-12 gap-4">
        {/* Chat List */}
        <Card className="col-span-3 flex flex-col overflow-hidden">
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar conversa..." className="pl-9" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {mockChats.map((chat) => (
              <button
                key={chat.id}
                onClick={() => setSelectedChat(chat.id)}
                className={cn(
                  "flex w-full items-center gap-3 border-b border-border px-3 py-3 text-left transition-colors hover:bg-accent",
                  selectedChat === chat.id && "bg-accent"
                )}
              >
                <Avatar className="h-10 w-10 shrink-0">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs">
                    {chat.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium truncate">{chat.name}</span>
                    <span className="text-xs text-muted-foreground">{chat.time}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{chat.lastMsg}</p>
                </div>
                {chat.unread > 0 && (
                  <Badge className="h-5 w-5 shrink-0 rounded-full p-0 text-xs flex items-center justify-center">
                    {chat.unread}
                  </Badge>
                )}
              </button>
            ))}
          </div>
        </Card>

        {/* Chat Area */}
        <Card className="col-span-6 flex flex-col overflow-hidden">
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center gap-3">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary/10 text-primary text-xs">JS</AvatarFallback>
              </Avatar>
              <div>
                <p className="text-sm font-medium">João Silva</p>
                <p className="text-xs text-muted-foreground">Online</p>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {mockMessages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "max-w-[70%] rounded-2xl px-4 py-2.5",
                  msg.from === "me"
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "bg-muted"
                )}
              >
                <p className="text-sm">{msg.text}</p>
                <p className={cn(
                  "mt-1 text-xs",
                  msg.from === "me" ? "text-primary-foreground/70" : "text-muted-foreground"
                )}>
                  {msg.time}
                </p>
              </div>
            ))}
          </div>

          <div className="border-t border-border p-3">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="shrink-0">
                <Paperclip className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="shrink-0">
                <Smile className="h-4 w-4" />
              </Button>
              <Input
                placeholder="Digite sua mensagem..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="flex-1"
              />
              <Button size="icon" className="shrink-0">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>

        {/* Contact Details */}
        <Card className="col-span-3 overflow-y-auto p-4">
          <div className="flex flex-col items-center text-center">
            <Avatar className="h-16 w-16">
              <AvatarFallback className="bg-primary/10 text-primary text-lg">JS</AvatarFallback>
            </Avatar>
            <h3 className="mt-3 font-heading font-semibold">João Silva</h3>
            <p className="text-sm text-muted-foreground">+55 (11) 99999-0001</p>
          </div>

          <div className="mt-6 space-y-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase">Tags</p>
              <div className="mt-2 flex flex-wrap gap-1">
                <Badge variant="secondary" className="bg-primary/15 text-primary">Cliente</Badge>
                <Badge variant="secondary" className="bg-warning/15 text-warning">VIP</Badge>
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase">Notas</p>
              <p className="mt-1 text-sm text-muted-foreground">Nenhuma nota adicionada.</p>
            </div>

            <div className="space-y-2">
              <Button variant="outline" className="w-full" size="sm">Adicionar Tag</Button>
              <Button variant="outline" className="w-full" size="sm">Transferir</Button>
              <Button variant="outline" className="w-full text-destructive" size="sm">Bloquear</Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default InboxPage;
