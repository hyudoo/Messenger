"use client";

import { Toaster } from "react-hot-toast";

// Toasts use the theme tokens so they match light and dark mode.
const ToasterContext = () => {
  return (
    <Toaster
      toastOptions={{
        style: {
          background: "rgb(var(--background))",
          color: "rgb(var(--foreground))",
          border: "1px solid rgb(var(--border))",
        },
      }}
    />
  );
};

export default ToasterContext;
