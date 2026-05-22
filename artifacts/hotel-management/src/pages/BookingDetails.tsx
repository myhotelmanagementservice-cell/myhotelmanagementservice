import { useParams, Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useGetBooking, 
  useUpdateBooking, 
  useDeleteBooking, 
  useCheckInBooking, 
  useCheckOutBooking, 
  getGetBookingQueryKey 
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ArrowLeft, Edit2, Trash2, CalendarCheck, CalendarMinus, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export default function BookingDetails() {
  const params = useParams();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isDeleting, setIsDeleting] = useState(false);

  const { data: booking, isLoading } = useGetBooking(id, { query: { enabled: !!id, queryKey: getGetBookingQueryKey(id) } });
  const updateBooking = useUpdateBooking();
  const deleteBooking = useDeleteBooking();
  const checkInBooking = useCheckInBooking();
  const checkOutBooking = useCheckOutBooking();

  const handleCheckIn = () => {
    checkInBooking.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBookingQueryKey(id) });
        toast({ title: "Checked In", description: "Guest has been successfully checked in." });
      },
      onError: () => toast({ title: "Error", description: "Failed to check in guest.", variant: "destructive" })
    });
  };

  const handleCheckOut = () => {
    checkOutBooking.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBookingQueryKey(id) });
        toast({ title: "Checked Out", description: "Guest has been successfully checked out." });
      },
      onError: () => toast({ title: "Error", description: "Failed to check out guest.", variant: "destructive" })
    });
  };

  const handleDelete = () => {
    deleteBooking.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Booking Deleted", description: "Reservation has been removed." });
        setLocation("/bookings");
      },
      onError: () => toast({ title: "Error", description: "Failed to delete booking.", variant: "destructive" })
    });
  };

  const handleCancel = () => {
    updateBooking.mutate({ id, data: { status: 'cancelled' } as any }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBookingQueryKey(id) });
        toast({ title: "Booking Cancelled", description: "The reservation has been cancelled." });
      },
      onError: () => toast({ title: "Error", description: "Failed to cancel booking.", variant: "destructive" })
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6 animate-in fade-in">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <Card>
          <CardContent className="p-8">
            <div className="space-y-4">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-2/3" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-semibold mb-2">Booking Not Found</h2>
        <p className="text-muted-foreground mb-6">The booking you are looking for doesn't exist or has been deleted.</p>
        <Link href="/bookings">
          <Button>Return to Bookings</Button>
        </Link>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'confirmed': return <Badge className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 text-sm">Confirmed</Badge>;
      case 'checked_in': return <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1 text-sm">Checked In</Badge>;
      case 'checked_out': return <Badge className="bg-gray-500 hover:bg-gray-600 text-white px-3 py-1 text-sm">Checked Out</Badge>;
      case 'cancelled': return <Badge className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 text-sm">Cancelled</Badge>;
      default: return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-4xl mx-auto">
      <div className="flex items-center gap-4">
        <Link href="/bookings">
          <Button variant="outline" size="icon" className="h-10 w-10 rounded-full border-border bg-card shadow-sm hover:bg-muted">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-serif font-bold text-foreground">Booking #{id}</h1>
            {getStatusBadge(booking.status)}
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Created on {format(new Date(booking.createdAt), 'MMMM d, yyyy')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card className="border-card-border shadow-sm">
            <CardHeader className="bg-muted/20 border-b pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5 text-muted-foreground" />
                Stay Details
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Check-in</div>
                  <div className="text-lg font-medium">{format(new Date(booking.checkInDate), 'EEEE, MMMM d, yyyy')}</div>
                  <div className="text-sm text-muted-foreground mt-1">From 3:00 PM</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Check-out</div>
                  <div className="text-lg font-medium">{format(new Date(booking.checkOutDate), 'EEEE, MMMM d, yyyy')}</div>
                  <div className="text-sm text-muted-foreground mt-1">Until 11:00 AM</div>
                </div>
              </div>

              {booking.notes && (
                <div className="mt-8 p-4 bg-amber-500/10 border border-amber-500/20 rounded-md">
                  <div className="text-sm font-semibold text-amber-800 mb-1">Special Notes / Requests</div>
                  <div className="text-sm text-amber-900/80">{booking.notes}</div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-card-border shadow-sm">
            <CardHeader className="bg-muted/20 border-b pb-4">
              <CardTitle className="text-lg">Quick Actions</CardTitle>
              <CardDescription>Update the lifecycle state of this reservation</CardDescription>
            </CardHeader>
            <CardContent className="p-6 flex flex-wrap gap-4">
              <Button 
                onClick={handleCheckIn} 
                disabled={booking.status !== 'confirmed' || checkInBooking.isPending}
                className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                data-testid="button-check-in"
              >
                <CalendarCheck className="h-4 w-4" /> 
                {checkInBooking.isPending ? "Checking In..." : "Check In Guest"}
              </Button>
              <Button 
                onClick={handleCheckOut} 
                disabled={booking.status !== 'checked_in' || checkOutBooking.isPending}
                className="gap-2 bg-gray-600 hover:bg-gray-700 text-white"
                data-testid="button-check-out"
              >
                <CalendarMinus className="h-4 w-4" /> 
                {checkOutBooking.isPending ? "Checking Out..." : "Check Out Guest"}
              </Button>
              <Button 
                variant="outline"
                onClick={handleCancel} 
                disabled={booking.status === 'cancelled' || booking.status === 'checked_out' || updateBooking.isPending}
                className="gap-2 text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                Cancel Reservation
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-card-border shadow-sm">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base font-semibold">Guest Information</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="font-medium text-lg text-primary">{booking.guestName}</div>
              <div className="text-sm text-muted-foreground mt-2">
                ID: {booking.guestId}
              </div>
              <Button variant="link" className="px-0 mt-2 h-auto text-sm text-secondary">
                View full profile &rarr;
              </Button>
            </CardContent>
          </Card>

          <Card className="border-card-border shadow-sm">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base font-semibold">Room details</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="flex justify-between items-center">
                <div className="font-bold text-2xl">Room {booking.roomNumber}</div>
                <Badge variant="outline" className="capitalize">{booking.roomType}</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="border-card-border shadow-sm bg-primary text-primary-foreground">
            <CardContent className="p-6">
              <div className="text-primary-foreground/80 text-sm font-medium mb-1">Total Amount</div>
              <div className="text-4xl font-bold tracking-tight">${booking.totalAmount}</div>
            </CardContent>
            <CardFooter className="p-4 pt-0 border-t border-primary-foreground/10 mt-4 flex justify-between">
              <Button variant="ghost" className="text-primary-foreground hover:bg-primary-foreground/20 hover:text-white px-2" size="sm">
                <Edit2 className="h-4 w-4 mr-2" /> Edit total
              </Button>
              <Button variant="ghost" className="text-red-300 hover:bg-red-500/20 hover:text-red-200 px-2" size="sm" onClick={() => setIsDeleting(true)}>
                <Trash2 className="h-4 w-4 mr-2" /> Delete
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>

      <Dialog open={isDeleting} onOpenChange={setIsDeleting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Booking</DialogTitle>
            <DialogDescription>
              Are you sure you want to completely remove this booking? This action is permanent.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleting(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteBooking.isPending}>
              {deleteBooking.isPending ? "Deleting..." : "Confirm Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}