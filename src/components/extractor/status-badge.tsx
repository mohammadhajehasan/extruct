"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Confidence } from "@/lib/extractor/types";

const CONF_STYLES: Record<Confidence, { cls: string; label: string }> = {
  HIGH: {
    cls: "bg-primary/15 text-primary border-primary/40",
    label: "ثقة عالية",
  },
  MED: {
    cls: "bg-tertiary/20 text-tertiary border-tertiary/40",
    label: "ثقة متوسطة",
  },
  LOW: {
    cls: "bg-destructive/15 text-destructive border-destructive/40",
    label: "ثقة من низية",
  },
  REVIEW: {
    cls: "bg-destructive/15 text-destructive border-destructive/40",
    label: "للمراجعة",
  },
};

interface StatusBadgeProps {
  confidence: Confidence;
  reasons?: string[];
  className?: string;
}

export function StatusBadge({ confidence, reasons, className }: StatusBadgeProps) {
  const style = CONF_STYLES[confidence] ?? CONF_STYLES.REVIEW;
  const badge = (
    <Badge variant="outline" className={`${style.cls} cursor-default ${className ?? ""}`}>
      {style.label}
    </Badge>
  );
  if (!reasons || reasons.length === 0) return badge;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <ul className="list-disc space-y-1 pe-4 text-xs">
            {reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
