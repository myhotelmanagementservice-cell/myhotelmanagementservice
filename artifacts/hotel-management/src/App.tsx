import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/Layout";

import Dashboard from "@/pages/Dashboard";
import Rooms from "@/pages/Rooms";
import Guests from "@/pages/Guests";
import Bookings from "@/pages/Bookings";
import BookingDetails from "@/pages/BookingDetails";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/rooms" component={Rooms} />
      <Route path="/guests" component={Guests} />
      <Route path="/bookings" component={Bookings} />
      <Route path="/bookings/:id" component={BookingDetails} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Layout>
            <Router />
          </Layout>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
