import { Link, useLocation } from "wouter";
import { Bed, Users, Calendar, LayoutDashboard, Menu, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/rooms", label: "Rooms", icon: Bed },
  { href: "/guests", label: "Guests", icon: Users },
  { href: "/bookings", label: "Bookings", icon: Calendar },
];

export function Sidebar() {
  const [location] = useLocation();

  return (
    <div className="flex h-full w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="flex h-16 items-center px-6 border-b border-sidebar-border">
        <div className="flex items-center gap-2 text-sidebar-primary">
          <Building2 className="h-6 w-6" />
          <span className="text-xl font-serif font-bold text-white tracking-wide">Inaya Hotel</span>
        </div>
      </div>
      <div className="flex-1 overflow-auto py-4">
        <nav className="space-y-1 px-4">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive 
                    ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
                data-testid={`nav-${item.label.toLowerCase()}`}
              >
                <item.icon className={cn("h-5 w-5", isActive ? "text-sidebar-primary" : "text-sidebar-foreground/50")} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="p-4 border-t border-sidebar-border text-xs text-sidebar-foreground/50">
        &copy; 2025 Inaya Management
      </div>
    </div>
  );
}
