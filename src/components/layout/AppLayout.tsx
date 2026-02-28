import { useState } from "react";
import { Outlet } from "react-router-dom";
import AppSidebar from "./AppSidebar";
import AppHeader from "./AppHeader";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

const AppLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      {!isMobile && <AppSidebar />}

      {/* Mobile sidebar in Sheet */}
      {isMobile && (
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-64 p-0">
            <AppSidebar mobile onNavigate={() => setSidebarOpen(false)} />
          </SheetContent>
        </Sheet>
      )}

      <div className={isMobile ? "" : "lg:pl-64"}>
        <AppHeader onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} />
        <main className="p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
