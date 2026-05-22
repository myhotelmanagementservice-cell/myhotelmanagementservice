import { useGetDashboardSummary, useGetRecentBookings, useGetRoomStatusBreakdown } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { Bed, Users, Calendar, DollarSign, ArrowRightLeft, ArrowLeftRight } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";

const COLORS = {
  available: "hsl(160, 60%, 45%)",
  occupied: "hsl(0, 84.2%, 60.2%)",
  maintenance: "hsl(38, 92%, 50%)",
  reserved: "hsl(215, 50%, 40%)"
};

export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  const { data: recentBookings, isLoading: isLoadingRecent } = useGetRecentBookings();
  const { data: breakdown, isLoading: isLoadingBreakdown } = useGetRoomStatusBreakdown();

  const chartData = breakdown ? [
    { name: "Available", value: breakdown.available, color: COLORS.available },
    { name: "Occupied", value: breakdown.occupied, color: COLORS.occupied },
    { name: "Maintenance", value: breakdown.maintenance, color: COLORS.maintenance },
    { name: "Reserved", value: breakdown.reserved, color: COLORS.reserved },
  ].filter(d => d.value > 0) : [];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-serif font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground">Overview of today's operations.</p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          title="Total Rooms" 
          value={summary?.totalRooms} 
          subtext={`${summary?.availableRooms || 0} available`} 
          icon={<Bed className="h-4 w-4 text-muted-foreground" />} 
          isLoading={isLoadingSummary} 
        />
        <StatCard 
          title="Total Guests" 
          value={summary?.totalGuests} 
          subtext="Registered in system" 
          icon={<Users className="h-4 w-4 text-muted-foreground" />} 
          isLoading={isLoadingSummary} 
        />
        <StatCard 
          title="Revenue Today" 
          value={summary ? `$${summary.revenueToday.toLocaleString()}` : undefined} 
          subtext={`$${summary?.revenueThisMonth.toLocaleString() || 0} this month`} 
          icon={<DollarSign className="h-4 w-4 text-muted-foreground" />} 
          isLoading={isLoadingSummary} 
        />
        <StatCard 
          title="Today's Activity" 
          value={summary ? `${summary.checkInsToday} / ${summary.checkOutsToday}` : undefined} 
          subtext="Check-ins / Check-outs" 
          icon={<ArrowRightLeft className="h-4 w-4 text-muted-foreground" />} 
          isLoading={isLoadingSummary} 
        />
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent Bookings</CardTitle>
            <CardDescription>Latest reservations made in the system</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingRecent ? (
              <div className="space-y-4">
                {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : recentBookings?.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No recent bookings.</div>
            ) : (
              <div className="space-y-4">
                {recentBookings?.slice(0, 5).map(booking => (
                  <div key={booking.id} className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-muted/20 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                        {booking.guestName?.charAt(0)}
                      </div>
                      <div>
                        <div className="font-medium">{booking.guestName}</div>
                        <div className="text-sm text-muted-foreground">
                          Room {booking.roomNumber} • {format(new Date(booking.checkInDate), 'MMM d')} - {format(new Date(booking.checkOutDate), 'MMM d')}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">${booking.totalAmount}</div>
                      <div className={`text-xs font-medium capitalize ${
                        booking.status === 'confirmed' ? 'text-blue-600' :
                        booking.status === 'checked_in' ? 'text-green-600' :
                        booking.status === 'checked_out' ? 'text-gray-600' : 'text-red-600'
                      }`}>
                        {booking.status.replace('_', ' ')}
                      </div>
                    </div>
                  </div>
                ))}
                {recentBookings && recentBookings.length > 0 && (
                  <div className="pt-2 text-center">
                    <Link href="/bookings" className="text-sm text-primary font-medium hover:underline">
                      View all bookings
                    </Link>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Room Status</CardTitle>
            <CardDescription>Current state of all rooms</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center min-h-[300px]">
            {isLoadingBreakdown ? (
              <Skeleton className="h-48 w-48 rounded-full" />
            ) : chartData.length === 0 ? (
              <div className="text-muted-foreground">No room data available</div>
            ) : (
              <div className="w-full h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip 
                      formatter={(value: number) => [`${value} rooms`, "Count"]}
                      contentStyle={{ borderRadius: '8px', border: '1px solid var(--border)' }}
                    />
                    <Legend verticalAlign="bottom" height={36} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ title, value, subtext, icon, isLoading }: { title: string, value?: number | string, subtext?: string, icon: React.ReactNode, isLoading?: boolean }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-4 w-32" />
          </div>
        ) : (
          <>
            <div className="text-2xl font-bold">{value ?? "-"}</div>
            {subtext && <p className="text-xs text-muted-foreground mt-1">{subtext}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
