import { NavLink, useLocation } from "react-router-dom";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import logo from "@/assets/logo.webp";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/contacts", label: "Contatos", icon: Users },
  { to: "/campaigns", label: "Campanhas", icon: Megaphone },
  { to: "/automations", label: "Automações", icon: Bot },
  { to: "/inbox", label: "Inbox", icon: Inbox },
  { to: "/funnels", label: "Funis", icon: GitBranchPlus },
  { to: "/templates", label: "Templates", icon: FileText },
  { to: "/reports", label: "Relatórios", icon: BarChart3 },
  { to: "/settings", label: "Configurações", icon: Settings },
];

interface AppSidebarProps {
  collapsed?: boolean;
  mobile?: boolean;
  onNavigate?: () => void;
}

const AppSidebar = ({ collapsed = false, mobile = false, onNavigate }: AppSidebarProps) => {
  const location = useLocation();

  return (
    <aside
      className={cn(
        "h-screen border-r border-sidebar-border bg-sidebar transition-all duration-200",
        mobile
          ? "w-full"
          : "fixed left-0 top-0 z-40 hidden lg:block",
        !mobile && (collapsed ? "w-16" : "w-64")
      )}
    >
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-4">
        <img src={logo} alt="Nutricar" className="h-9 w-auto" />
        {!collapsed && (
          <span className="font-heading text-lg font-bold text-sidebar-foreground">
            NUTRICAR
          </span>
        )}
      </div>

      <nav className="flex flex-col gap-1 p-3">
        {navItems.map((item) => {
          const isActive = location.pathname.startsWith(item.to);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-sidebar-foreground hover:bg-sidebar-accent"
              )}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
};

export default AppSidebar;
