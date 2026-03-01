import { Bell, Moon, Sun, Search, LogOut, User, Smartphone, WifiOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useTheme } from "@/hooks/useTheme";
import { useWhatsAppStatus } from "@/hooks/useWhatsAppStatus";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";

const WhatsAppIndicator = () => {
  const { instances, status, info, loading } = useWhatsAppStatus();
  const navigate = useNavigate();

  // Multi-instance mode
  if (instances.length > 0) {
    return (
      <div className="flex items-center gap-0.5">
        {instances.map((inst) => (
          <Tooltip key={inst.id}>
            <TooltipTrigger asChild>
              <button
                onClick={() => navigate("/settings")}
                className="relative flex h-8 items-center gap-1 rounded-lg px-2 transition-colors hover:bg-accent"
              >
                {inst.status === "connected" ? (
                  <>
                    <Smartphone className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-1 ring-card" />
                  </>
                ) : (
                  <>
                    <WifiOff className="h-3.5 w-3.5 text-destructive" />
                    <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-destructive ring-1 ring-card" />
                  </>
                )}
                <span className="text-[10px] font-medium text-muted-foreground hidden sm:inline max-w-[60px] truncate">
                  {inst.name}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[200px] text-center">
              <p className="text-xs font-medium">{inst.name}</p>
              <p className="text-[10px]">
                {inst.status === "connected"
                  ? `Conectado${inst.phone ? ` — ${inst.phone}` : ""}`
                  : "Desconectado"}
              </p>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    );
  }

  // Legacy single instance
  const tooltipText =
    status === "connected"
      ? `WhatsApp conectado${info?.name ? ` — ${info.name}` : ""}${info?.phone ? ` (${info.phone})` : ""}`
      : status === "disconnected" || status === "error"
      ? "WhatsApp desconectado — clique para configurar"
      : status === "checking"
      ? "Verificando conexão..."
      : "WhatsApp não configurado";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => navigate("/settings")}
          className="relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-accent"
        >
          {status === "checking" ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : status === "connected" ? (
            <>
              <Smartphone className="h-4 w-4 text-emerald-500" />
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-card" />
            </>
          ) : status === "disconnected" || status === "error" ? (
            <>
              <WifiOff className="h-4 w-4 text-destructive" />
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive ring-2 ring-card" />
            </>
          ) : (
            <Smartphone className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[200px] text-center">
        <p className="text-xs">{tooltipText}</p>
      </TooltipContent>
    </Tooltip>
  );
};

const AppHeader = () => {
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-card px-6">
      <div className="flex items-center gap-4">
        <SidebarTrigger className="-ml-2" />

        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar... (Cmd+K)"
            className="h-9 w-48 lg:w-72 rounded-lg border border-input bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="flex items-center gap-1">
        <WhatsAppIndicator />

        <Button variant="ghost" size="icon" onClick={toggleTheme}>
          {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>

        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2 pl-2">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary text-primary-foreground text-xs">NC</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => navigate("/settings")}>
              <User className="mr-2 h-4 w-4" /> Perfil
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" /> Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};

export default AppHeader;
