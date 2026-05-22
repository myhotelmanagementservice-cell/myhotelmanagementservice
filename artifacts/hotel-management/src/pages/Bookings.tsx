import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useListBookings, useCreateBooking, getListBookingsQueryKey,
  useListGuests, useListRooms
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Eye, Calendar as CalendarIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Link } from "wouter";

const bookingSchema = z.object({
  guestId: z.coerce.number().min(1, "Guest is required"),
  roomId: z.coerce.number().min(1, "Room is required"),
  checkInDate: z.string().min(1, "Check-in date is required"),
  checkOutDate: z.string().min(1, "Check-out date is required"),
  totalAmount: z.coerce.number().min(0, "Amount must be positive"),
  notes: z.string().optional(),
});

type BookingFormValues = z.infer<typeof bookingSchema>;

export default function Bookings() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isAddOpen, setIsAddOpen] = useState(false);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: bookings = [], isLoading } = useListBookings(
    statusFilter !== "all" ? { status: statusFilter as any } : undefined
  );
  
  // Data for the Add form
  const { data: guests = [] } = useListGuests();
  const { data: rooms = [] } = useListRooms({ status: 'available' }); 
  
  const createBooking = useCreateBooking();

  const form = useForm<BookingFormValues>({
    resolver: zodResolver(bookingSchema),
    defaultValues: {
      guestId: 0,
      roomId: 0,
      checkInDate: format(new Date(), 'yyyy-MM-dd'),
      checkOutDate: format(new Date(Date.now() + 86400000), 'yyyy-MM-dd'),
      totalAmount: 0,
      notes: "",
    }
  });

  const onOpenAdd = () => {
    form.reset({
      guestId: 0,
      roomId: 0,
      checkInDate: format(new Date(), 'yyyy-MM-dd'),
      checkOutDate: format(new Date(Date.now() + 86400000), 'yyyy-MM-dd'),
      totalAmount: 0,
      notes: "",
    });
    setIsAddOpen(true);
  };

  const onSubmit = (values: BookingFormValues) => {
    createBooking.mutate(
      { data: values },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() });
          toast({ title: "Booking created", description: "The reservation was successfully made." });
          setIsAddOpen(false);
        },
        onError: () => toast({ title: "Error", description: "Failed to create booking.", variant: "destructive" })
      }
    );
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'confirmed': return <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20">Confirmed</Badge>;
      case 'checked_in': return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Checked In</Badge>;
      case 'checked_out': return <Badge variant="outline" className="bg-gray-500/10 text-gray-600 border-gray-500/20">Checked Out</Badge>;
      case 'cancelled': return <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20">Cancelled</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-serif font-bold text-foreground">Bookings</h1>
          <p className="text-muted-foreground">Manage all hotel reservations and active stays.</p>
        </div>
        <Button onClick={onOpenAdd} className="gap-2 shadow-sm" data-testid="button-add-booking">
          <Plus className="h-4 w-4" /> New Booking
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-4 bg-card p-4 rounded-lg shadow-sm border border-card-border">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[220px] bg-background" data-testid="select-status-filter">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Bookings</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="checked_in">Checked In</SelectItem>
            <SelectItem value="checked_out">Checked Out</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader className="py-4 border-b">
          <CardTitle className="text-lg">Reservations List</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px] pl-6">ID</TableHead>
                <TableHead>Guest</TableHead>
                <TableHead>Room</TableHead>
                <TableHead>Check In</TableHead>
                <TableHead>Check Out</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right pr-6">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-muted-foreground animate-pulse">Loading bookings...</TableCell>
                </TableRow>
              ) : bookings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">No bookings found.</TableCell>
                </TableRow>
              ) : (
                bookings.map(booking => (
                  <TableRow key={booking.id} className="hover:bg-muted/30" data-testid={`row-booking-${booking.id}`}>
                    <TableCell className="font-medium pl-6">#{booking.id}</TableCell>
                    <TableCell className="font-medium text-primary">{booking.guestName}</TableCell>
                    <TableCell>{booking.roomNumber} <span className="text-xs text-muted-foreground ml-1">({booking.roomType})</span></TableCell>
                    <TableCell>{format(new Date(booking.checkInDate), 'MMM d, yyyy')}</TableCell>
                    <TableCell>{format(new Date(booking.checkOutDate), 'MMM d, yyyy')}</TableCell>
                    <TableCell>{getStatusBadge(booking.status)}</TableCell>
                    <TableCell className="text-right pr-6">
                      <Link href={`/bookings/${booking.id}`}>
                        <Button variant="ghost" size="sm" className="h-8 gap-2">
                          <Eye className="h-4 w-4" /> View
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add Booking Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>New Booking</DialogTitle>
            <DialogDescription>
              Create a new reservation. Select a guest and an available room.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="guestId" render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Guest</FormLabel>
                    <Select onValueChange={(val) => field.onChange(parseInt(val))} value={field.value ? field.value.toString() : undefined}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select a guest" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {guests.map(g => (
                          <SelectItem key={g.id} value={g.id.toString()}>{g.firstName} {g.lastName} ({g.email})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="roomId" render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Available Room</FormLabel>
                    <Select onValueChange={(val) => field.onChange(parseInt(val))} value={field.value ? field.value.toString() : undefined}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select a room" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {rooms.map(r => (
                          <SelectItem key={r.id} value={r.id.toString()}>Room {r.number} - {r.type} (${r.pricePerNight}/night)</SelectItem>
                        ))}
                        {rooms.length === 0 && <SelectItem value="0" disabled>No rooms available</SelectItem>}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="checkInDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Check-in Date</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="checkOutDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Check-out Date</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="totalAmount" render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Total Amount ($)</FormLabel>
                    <FormControl><Input type="number" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="notes" render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Notes (Optional)</FormLabel>
                    <FormControl><Input placeholder="Special requests..." {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <DialogFooter className="pt-4">
                <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createBooking.isPending}>
                  {createBooking.isPending ? "Creating..." : "Create Booking"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}