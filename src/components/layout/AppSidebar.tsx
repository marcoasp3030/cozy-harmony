import { useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Megaphone,
  Bot,
  Inbox,
  FileText,
  BarChart3,
  Settings,
  GitBranchPlus,
  ClipboardList,
  ChevronsLeft,
  Headphones,
  ListOrdered,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import logo from "@/assets/logo.webp";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuBadge,
  SidebarHeader,
  SidebarFooter,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSidebarBadges } from "@/hooks/useSidebarBadges";

const mainItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, badgeKey: null },
  { to: "/inbox", label: "Inbox", icon: Inbox, badgeKey: "inbox" as const },
  { to: "/contacts", label: "Contatos", icon: Users, badgeKey: null },
  { to: "/campaigns", label: "Campanhas", icon: Megaphone, badgeKey: "campaigns" as const },
  { to: "/automations", label: "Automações", icon: Bot, badgeKey: "automations" as const },
  { to: "/funnels", label: "Funis", icon: GitBranchPlus, badgeKey: null },
  { to: "/occurrences", label: "Ocorrências", icon: ClipboardList, badgeKey: null },
  { to: "/queue", label: "Fila", icon: ListOrdered, badgeKey: null },
  { to: "/attendants", label: "Atendentes", icon: Headphones, badgeKey: null },
];

const secondaryItems = [
  { to: "/templates", label: "Templates", icon: FileText, badgeKey: null },
  { to: "/reports", label: "Relatórios", icon: BarChart3, badgeKey: null },
  { to: "/settings", label: "Configurações", icon: Settings, badgeKey: null },
];

type BadgeKey = "inbox" | "campaigns" | "automations";

const AppSidebar = () => {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const badges = useSidebarBadges();

  const renderItem = (item: { to: string; label: string; icon: any; badgeKey: BadgeKey | null }) => {
    const isActive = location.pathname.startsWith(item.to);
    const Icon = item.icon;
    const badgeCount = item.badgeKey ? badges[item.badgeKey] : 0;

    return (
      <SidebarMenuItem key={item.to}>
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarMenuButton asChild isActive={isActive}>
              <NavLink
                to={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-sidebar-foreground hover:bg-sidebar-accent"
                )}
              >
                <span className="relative shrink-0">
                  <Icon className="h-5 w-5" />
                  {collapsed && badgeCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-0.5 text-[8px] font-bold text-destructive-foreground">
                      {badgeCount > 99 ? "99+" : badgeCount}
                    </span>
                  )}
                </span>
                <span className="flex-1">{item.label}</span>
              </NavLink>
            </SidebarMenuButton>
          </TooltipTrigger>
          {collapsed && (
            <TooltipContent side="right">
              {item.label}
              {badgeCount > 0 && ` (${badgeCount})`}
            </TooltipContent>
          )}
        </Tooltip>
        {!collapsed && badgeCount > 0 && (
          <SidebarMenuBadge className={cn(
            "text-[10px] font-bold",
            item.badgeKey === "inbox"
              ? "bg-destructive text-destructive-foreground"
              : item.badgeKey === "automations"
              ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
              : "bg-primary/15 text-primary"
          )}>
            {badgeCount > 99 ? "99+" : badgeCount}
          </SidebarMenuBadge>
        )}
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex h-12 items-center justify-center px-3">
          <img src={logo} alt="Logo" className="h-8 w-auto shrink-0" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Principal</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map(renderItem)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Ferramentas</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {secondaryItems.map(renderItem)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleSidebar}
          className="w-full justify-center gap-2 text-xs text-muted-foreground"
        >
          <ChevronsLeft className={cn("h-4 w-4 transition-transform duration-200", collapsed && "rotate-180")} />
          {!collapsed && <span>Recolher</span>}
        </Button>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
};

export default AppSidebar;
