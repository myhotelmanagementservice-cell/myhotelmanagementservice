import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListRooms, useCreateRoom, useUpdateRoom, useDeleteRoom, getListRoomsQueryKey } from "@workspace/api-client-react";
import type { Room, RoomInputType, RoomInputStatus } from "@workspace/api-client-react/src/generated/api.schemas";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Edit2, Trash2, Search } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

const roomSchema = z.object({
  number: z.string().min(1, "Required"),
  type: z.enum(["single", "double", "suite", "deluxe", "penthouse"]),
  status: z.enum(["available", "occupied", "maintenance", "reserved"]).optional(),
  pricePerNight: z.coerce.number().min(0),
  floor: z.coerce.number().min(0),
  capacity: z.coerce.number().min(1),
  description: z.string().optional(),
  amenities: z.string().optional(),
});

type RoomFormValues = z.infer<typeof roomSchema>;

export default function Rooms() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [deletingRoom, setDeletingRoom] = useState<Room | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: rooms = [], isLoading } = useListRooms(
    statusFilter !== "all" ? { status: statusFilter as any } : undefined
  );
  const createRoom = useCreateRoom();
  const updateRoom = useUpdateRoom();
  const deleteRoom = useDeleteRoom();

  const filteredRooms = rooms.filter(room => 
    room.number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    room.type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const form = useForm<RoomFormValues>({
    resolver: zodResolver(roomSchema),
    defaultValues: {
      number: "",
      type: "single",
      status: "available",
      pricePerNight: 100,
      floor: 1,
      capacity: 1,
      description: "",
      amenities: "",
    }
  });

  const onOpenAdd = () => {
    form.reset({
      number: "", type: "single", status: "available", pricePerNight: 100, floor: 1, capacity: 1, description: "", amenities: ""
    });
    setIsAddOpen(true);
  };

  const onOpenEdit = (room: Room) => {
    form.reset({
      number: room.number,
      type: room.type as any,
      status: room.status as any,
      pricePerNight: room.pricePerNight,
      floor: room.floor,
      capacity: room.capacity,
      description: room.description || "",
      amenities: room.amenities || "",
    });
    setEditingRoom(room);
  };

  const onSubmit = (values: RoomFormValues) => {
    if (editingRoom) {
      updateRoom.mutate(
        { id: editingRoom.id, data: values as any },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListRoomsQueryKey() });
            toast({ title: "Room updated", description: `Room ${values.number} has been updated.` });
            setEditingRoom(null);
          },
          onError: () => toast({ title: "Error", description: "Failed to update room.", variant: "destructive" })
        }
      );
    } else {
      createRoom.mutate(
        { data: values as any },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListRoomsQueryKey() });
            toast({ title: "Room created", description: `Room ${values.number} has been created.` });
            setIsAddOpen(false);
          },
          onError: () => toast({ title: "Error", description: "Failed to create room.", variant: "destructive" })
        }
      );
    }
  };

  const onDelete = () => {
    if (!deletingRoom) return;
    deleteRoom.mutate(
      { id: deletingRoom.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListRoomsQueryKey() });
          toast({ title: "Room deleted", description: `Room ${deletingRoom.number} has been deleted.` });
          setDeletingRoom(null);
        },
        onError: () => toast({ title: "Error", description: "Failed to delete room.", variant: "destructive" })
      }
    );
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'available': return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
      case 'occupied': return "bg-red-500/10 text-red-600 border-red-500/20";
      case 'maintenance': return "bg-amber-500/10 text-amber-600 border-amber-500/20";
      case 'reserved': return "bg-blue-500/10 text-blue-600 border-blue-500/20";
      default: return "bg-gray-500/10 text-gray-600 border-gray-500/20";
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-serif font-bold text-foreground">Rooms</h1>
          <p className="text-muted-foreground">Manage hotel rooms and availability.</p>
        </div>
        <Button onClick={onOpenAdd} className="gap-2 shadow-sm" data-testid="button-add-room">
          <Plus className="h-4 w-4" /> Add Room
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-4 bg-card p-4 rounded-lg shadow-sm border border-card-border">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search by room number or type..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 bg-background"
            data-testid="input-search-rooms"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[180px] bg-background" data-testid="select-status-filter">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="occupied">Occupied</SelectItem>
            <SelectItem value="maintenance">Maintenance</SelectItem>
            <SelectItem value="reserved">Reserved</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <div className="col-span-full text-center py-12 text-muted-foreground animate-pulse">Loading rooms...</div>
        ) : filteredRooms.length === 0 ? (
          <div className="col-span-full text-center py-12 border border-dashed rounded-lg text-muted-foreground bg-card/50">
            No rooms found matching your criteria.
          </div>
        ) : (
          filteredRooms.map(room => (
            <Card key={room.id} className="overflow-hidden hover:shadow-md transition-all group" data-testid={`card-room-${room.id}`}>
              <CardHeader className="pb-3 border-b bg-muted/20">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-2xl font-bold flex items-center gap-2">
                      {room.number}
                    </CardTitle>
                    <CardDescription className="capitalize mt-1 font-medium text-foreground/70">
                      {room.type} • Floor {room.floor}
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className={getStatusColor(room.status)}>
                    {room.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-sm text-muted-foreground">Price/Night</div>
                    <div className="font-bold text-lg text-primary">${room.pricePerNight}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-muted-foreground">Capacity</div>
                    <div className="font-medium">{room.capacity} Person(s)</div>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 pt-2 border-t opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="sm" onClick={() => onOpenEdit(room)} data-testid={`button-edit-room-${room.id}`}>
                    <Edit2 className="h-4 w-4 mr-2" /> Edit
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setDeletingRoom(room)} data-testid={`button-delete-room-${room.id}`}>
                    <Trash2 className="h-4 w-4 mr-2" /> Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Add / Edit Dialog */}
      <Dialog open={isAddOpen || !!editingRoom} onOpenChange={(open) => {
        if (!open) { setIsAddOpen(false); setEditingRoom(null); }
      }}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{editingRoom ? "Edit Room" : "Add New Room"}</DialogTitle>
            <DialogDescription>
              {editingRoom ? "Make changes to the existing room details." : "Enter the details for the new room."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="number" render={({ field }) => (
                  <FormItem><FormLabel>Room Number</FormLabel><FormControl><Input placeholder="e.g. 101" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="type" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="single">Single</SelectItem>
                        <SelectItem value="double">Double</SelectItem>
                        <SelectItem value="suite">Suite</SelectItem>
                        <SelectItem value="deluxe">Deluxe</SelectItem>
                        <SelectItem value="penthouse">Penthouse</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="pricePerNight" render={({ field }) => (
                  <FormItem><FormLabel>Price per Night ($)</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="capacity" render={({ field }) => (
                  <FormItem><FormLabel>Capacity</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="floor" render={({ field }) => (
                  <FormItem><FormLabel>Floor</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="available">Available</SelectItem>
                        <SelectItem value="occupied">Occupied</SelectItem>
                        <SelectItem value="maintenance">Maintenance</SelectItem>
                        <SelectItem value="reserved">Reserved</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <DialogFooter className="pt-4">
                <Button type="button" variant="outline" onClick={() => { setIsAddOpen(false); setEditingRoom(null); }}>Cancel</Button>
                <Button type="submit" disabled={createRoom.isPending || updateRoom.isPending}>
                  {createRoom.isPending || updateRoom.isPending ? "Saving..." : "Save Room"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deletingRoom} onOpenChange={(open) => !open && setDeletingRoom(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deletion</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete room {deletingRoom?.number}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingRoom(null)}>Cancel</Button>
            <Button variant="destructive" onClick={onDelete} disabled={deleteRoom.isPending}>
              {deleteRoom.isPending ? "Deleting..." : "Delete Room"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}