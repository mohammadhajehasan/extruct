"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer flex h-8 w-[52px] shrink-0 items-center justify-start rounded-full border-2 outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:justify-end data-[state=checked]:border-transparent data-[state=checked]:bg-primary data-[state=unchecked]:justify-start data-[state=unchecked]:border-outline data-[state=unchecked]:bg-surface-container-highest",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "bg-outline pointer-events-none me-auto ms-4 block size-4 rounded-full transition-all data-[state=checked]:me-3 data-[state=checked]:ms-auto data-[state=checked]:size-6 data-[state=checked]:bg-primary-foreground"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
