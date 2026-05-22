import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListGuests, useCreateGuest, useUpdateGuest, useDeleteGuest, getListGuestsQueryKey } from "@workspace/api-client-react";
import type { Guest } from "@workspace/api-client-react/src/generated/api.schemas";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Plus, Edit2, Trash2, Search, Mail, Phone, MapPin } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const guestSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(1, "Phone is required"),
  address: z.string().optional(),
  nationality: z.string().optional(),
  idType: z.string().optional(),
  idNumber: z.string().optional(),
});

type GuestFormValues = z.infer<typeof guestSchema>;

export default function Guests() {
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingGuest, setEditingGuest] = useState<Guest | null>(null);
  const [deletingGuest, setDeletingGuest] = useState<Guest | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: guests = [], isLoading } = useListGuests(
    debouncedSearch ? { search: debouncedSearch } : undefined
  );
  
  const createGuest = useCreateGuest();
  const updateGuest = useUpdateGuest();
  const deleteGuest = useDeleteGuest();

  const form = useForm<GuestFormValues>({
    resolver: zodResolver(guestSchema),
    defaultValues: {
      firstName: "", lastName: "", email: "", phone: "", address: "", nationality: "", idType: "", idNumber: ""
    }
  });

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    // Simple debounce equivalent for search
    setTimeout(() => setDebouncedSearch(e.target.value), 300);
  };

  const onOpenAdd = () => {
    form.reset({ firstName: "", lastName: "", email: "", phone: "", address: "", nationality: "", idType: "", idNumber: "" });
    setIsAddOpen(true);
  };

  const onOpenEdit = (guest: Guest) => {
    form.reset({
      firstName: guest.firstName,
      lastName: guest.lastName,
      email: guest.email,
      phone: guest.phone,
      address: guest.address || "",
      nationality: guest.nationality || "",
      idType: guest.idType || "",
      idNumber: guest.idNumber || "",
    });
    setEditingGuest(guest);
  };

  const onSubmit = (values: GuestFormValues) => {
    if (editingGuest) {
      updateGuest.mutate(
        { id: editingGuest.id, data: values },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListGuestsQueryKey() });
            toast({ title: "Guest updated", description: `${values.firstName} has been updated.` });
            setEditingGuest(null);
          },
          onError: () => toast({ title: "Error", description: "Failed to update guest.", variant: "destructive" })
        }
      );
    } else {
      createGuest.mutate(
        { data: values },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListGuestsQueryKey() });
            toast({ title: "Guest created", description: `${values.firstName} has been registered.` });
            setIsAddOpen(false);
          },
          onError: () => toast({ title: "Error", description: "Failed to create guest.", variant: "destructive" })
        }
      );
    }
  };

  const onDelete = () => {
    if (!deletingGuest) return;
    deleteGuest.mutate(
      { id: deletingGuest.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListGuestsQueryKey() });
          toast({ title: "Guest deleted", description: `${deletingGuest.firstName} has been deleted.` });
          setDeletingGuest(null);
        },
        onError: () => toast({ title: "Error", description: "Failed to delete guest.", variant: "destructive" })
      }
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-serif font-bold text-foreground">Guests</h1>
          <p className="text-muted-foreground">Manage guest profiles and history.</p>
        </div>
        <Button onClick={onOpenAdd} className="gap-2 shadow-sm" data-testid="button-add-guest">
          <Plus className="h-4 w-4" /> Add Guest
        </Button>
      </div>

      <div className="bg-card p-4 rounded-lg shadow-sm border border-card-border">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search guests by name or email..." 
            value={searchTerm}
            onChange={handleSearchChange}
            className="pl-9 bg-background"
            data-testid="input-search-guests"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <div className="col-span-full text-center py-12 text-muted-foreground animate-pulse">Loading guests...</div>
        ) : guests.length === 0 ? (
          <div className="col-span-full text-center py-12 border border-dashed rounded-lg text-muted-foreground bg-card/50">
            No guests found matching your criteria.
          </div>
        ) : (
          guests.map(guest => (
            <Card key={guest.id} className="hover:shadow-md transition-all group overflow-hidden" data-testid={`card-guest-${guest.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-full bg-secondary/10 flex items-center justify-center text-secondary font-bold text-xl">
                      {guest.firstName.charAt(0)}{guest.lastName.charAt(0)}
                    </div>
                    <div>
                      <CardTitle className="text-lg font-bold">{guest.firstName} {guest.lastName}</CardTitle>
                      <CardDescription className="text-xs mt-0.5">Joined {format(new Date(guest.createdAt), 'MMM yyyy')}</CardDescription>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-2 text-sm text-muted-foreground space-y-2">
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5" />
                  <span className="truncate">{guest.email}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5" />
                  <span>{guest.phone}</span>
                </div>
                {guest.nationality && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5" />
                    <span>{guest.nationality}</span>
                  </div>
                )}
                
                <div className="flex items-center justify-end gap-2 pt-4 border-t opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="sm" onClick={() => onOpenEdit(guest)} data-testid={`button-edit-guest-${guest.id}`}>
                    <Edit2 className="h-4 w-4 mr-2" /> Edit
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setDeletingGuest(guest)} data-testid={`button-delete-guest-${guest.id}`}>
                    <Trash2 className="h-4 w-4 mr-2" /> Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Add / Edit Dialog */}
      <Dialog open={isAddOpen || !!editingGuest} onOpenChange={(open) => {
        if (!open) { setIsAddOpen(false); setEditingGuest(null); }
      }}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{editingGuest ? "Edit Guest" : "Add New Guest"}</DialogTitle>
            <DialogDescription>
              {editingGuest ? "Update the guest's profile information." : "Enter details to register a new guest."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="firstName" render={({ field }) => (
                  <FormItem><FormLabel>First Name</FormLabel><FormControl><Input placeholder="Jane" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="lastName" render={({ field }) => (
                  <FormItem><FormLabel>Last Name</FormLabel><FormControl><Input placeholder="Doe" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" placeholder="jane@example.com" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="phone" render={({ field }) => (
                  <FormItem><FormLabel>Phone</FormLabel><FormControl><Input placeholder="+1 555 1234" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <div className="col-span-2">
                  <FormField control={form.control} name="address" render={({ field }) => (
                    <FormItem><FormLabel>Address (Optional)</FormLabel><FormControl><Input placeholder="123 Main St" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="nationality" render={({ field }) => (
                  <FormItem><FormLabel>Nationality (Optional)</FormLabel><FormControl><Input placeholder="USA" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="idType" render={({ field }) => (
                  <FormItem><FormLabel>ID Type (Optional)</FormLabel><FormControl><Input placeholder="Passport" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="idNumber" render={({ field }) => (
                  <FormItem><FormLabel>ID Number (Optional)</FormLabel><FormControl><Input placeholder="P123456" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <DialogFooter className="pt-4">
                <Button type="button" variant="outline" onClick={() => { setIsAddOpen(false); setEditingGuest(null); }}>Cancel</Button>
                <Button type="submit" disabled={createGuest.isPending || updateGuest.isPending}>
                  {createGuest.isPending || updateGuest.isPending ? "Saving..." : "Save Guest"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deletingGuest} onOpenChange={(open) => !open && setDeletingGuest(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deletion</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete guest {deletingGuest?.firstName} {deletingGuest?.lastName}? This action cannot be undone and will remove them from the directory.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingGuest(null)}>Cancel</Button>
            <Button variant="destructive" onClick={onDelete} disabled={deleteGuest.isPending}>
              {deleteGuest.isPending ? "Deleting..." : "Delete Guest"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}