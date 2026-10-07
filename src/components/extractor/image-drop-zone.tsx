"use client";

import { useCallback, useRef, useState } from "react";
import { UploadCloud, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface ImageDropZoneProps {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  hint?: string;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
}

/** منطقة رفع بالسحب والإفلات + النقر — صور وPDF */
export function ImageDropZone({
  onFiles,
  accept = "image/*,application/pdf",
  multiple = true,
  hint,
  disabled,
  className,
  compact,
}: ImageDropZoneProps) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      const files = Array.from(list).filter(
        (f) => f.type.startsWith("image/") || f.type === "application/pdf"
      );
      if (files.length > 0) onFiles(multiple ? files : [files[0]]);
    },
    [onFiles, multiple]
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="منطقة رفع الصور أو ملفات PDF"
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) handleFiles(e.dataTransfer.files);
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed transition-colors select-none cursor-pointer min-h-24",
        compact ? "p-4" : "p-8",
        over
          ? "border-primary bg-primary/10"
          : "border-border hover:border-primary/60 hover:bg-accent/40",
        disabled && "opacity-50 pointer-events-none",
        className
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {over ? (
        <FileText className="h-8 w-8 text-primary" aria-hidden />
      ) : (
        <UploadCloud className="h-8 w-8 text-muted-foreground" aria-hidden />
      )}
      <p className="text-sm font-semibold text-foreground">
        اسحب الصور أو PDF هنا، أو انقر للاختيار
      </p>
      <p className="text-xs text-muted-foreground">
        {hint ?? "يُدعم عدة صور دفعة واحدة وملفات PDF (نصية أو ممسوحة)"}
      </p>
    </div>
  );
}

/** قراءة ملف إلى dataUrl */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`فشل قراءة الملف: ${file.name}`));
    reader.readAsDataURL(file);
  });
}
