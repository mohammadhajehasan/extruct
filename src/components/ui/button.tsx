import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-all select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        // M3 filled button — elevation 1 → 2 on hover
        default:
          "bg-primary text-primary-foreground shadow-[var(--elevation-1)] hover:bg-primary/92 hover:shadow-[var(--elevation-2)]",
        destructive:
          "bg-destructive text-white shadow-[var(--elevation-1)] hover:bg-destructive/92 hover:shadow-[var(--elevation-2)] focus-visible:ring-destructive/30",
        // M3 outlined button — 1px outline, primary label, state-layer hover
        outline:
          "border border-outline bg-transparent text-primary hover:bg-primary/8",
        // M3 tonal button — secondary-container
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/85",
        // M3 text button — primary label, state-layer hover
        ghost: "text-primary hover:bg-primary/8",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-6 py-2 has-[>svg]:gap-2",
        sm: "h-9 gap-1.5 px-4 has-[>svg]:px-3",
        lg: "h-12 px-8 text-base has-[>svg]:px-6",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
