import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Bell, Search, User } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="flex h-16 shrink-0 items-center gap-x-4 border-b bg-card px-6">
          <div className="flex flex-1 items-center gap-x-4 lg:gap-x-6">
            <div className="relative flex-1 flex">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search bookings, guests, or rooms..." 
                className="pl-9 w-full max-w-md bg-muted/50 border-none focus-visible:ring-1 focus-visible:bg-background"
              />
            </div>
            <div className="flex items-center gap-x-4">
              <Button variant="ghost" size="icon" className="relative text-muted-foreground">
                <Bell className="h-5 w-5" />
                <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-primary" />
              </Button>
              <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-medium">
                <User className="h-4 w-4" />
              </div>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
