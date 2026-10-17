import { Slot } from "radix-ui";
import type { ComponentProps } from "react";

type ButtonProps = ComponentProps<"button"> & { asChild?: boolean; variant?: "primary" | "outline" | "ghost" };

export function Button({ asChild = false, variant = "primary", className = "", type = "button", ...props }: ButtonProps) {
  const Component = asChild ? Slot.Root : "button";
  return <Component type={type} className={`button button-${variant} ${className}`} {...props} />;
}
