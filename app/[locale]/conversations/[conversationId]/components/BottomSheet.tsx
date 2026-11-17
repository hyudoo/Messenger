"use client";

import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
}

// A panel sliding up from the bottom (touch screens): the message menu, who reacted.
// Closed by the backdrop or Esc.
const BottomSheet: React.FC<BottomSheetProps> = ({ open, onClose, title, children }) => (
  <Dialog open={open} onClose={onClose} className="relative z-50">
    <DialogBackdrop
      transition
      className="fixed inset-0 bg-foreground/30 transition duration-200 data-[closed]:opacity-0"
    />
    <div className="fixed inset-x-0 bottom-0 flex justify-center">
      <DialogPanel
        transition
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-background px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-xl transition duration-200 ease-out data-[closed]:translate-y-full">
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted" aria-hidden />
        <DialogTitle as="div" className="mb-2 px-1 text-center text-xs text-muted-foreground">
          {title}
        </DialogTitle>
        {children}
      </DialogPanel>
    </div>
  </Dialog>
);

export default BottomSheet;
