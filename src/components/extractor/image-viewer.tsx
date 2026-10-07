"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, Maximize2, Download, X } from "lucide-react";
import { loadImage } from "@/lib/extractor/imaging";

interface ImageViewerProps {
  imageUrl: string;
  imageName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImageViewer({ imageUrl, imageName, open, onOpenChange }: ImageViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!open) return;
    loadImage(imageUrl).then((img) => {
      setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
    }).catch(() => { /* ignore */ });
  }, [open, imageUrl]);

  const MIN_ZOOM = 0.3;
  const MAX_ZOOM = 5;
  const ZOOM_STEP = 0.25;

  const handleOpenChange = (v: boolean) => {
    if (!v) setZoom(1);
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[95vw] max-h-[95vh] p-0 overflow-hidden"
        dir="rtl"
      >
        <DialogHeader className="shrink-0 px-6 pt-4 pb-2">
          <DialogTitle className="flex items-center justify-between gap-2 text-base">
            <span className="truncate">{imageName}</span>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2)))}
                disabled={zoom >= MAX_ZOOM}
                aria-label="تكبير"
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setZoom((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2)))}
                disabled={zoom <= MIN_ZOOM}
                aria-label="تصغير"
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setZoom(1)}
                disabled={zoom === 1}
                aria-label="إعادة المعاينة"
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => onOpenChange(false)}
                aria-label="إغلاق"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </DialogTitle>
          <DialogDescription className="text-[10px] text-muted-foreground tabular-nums">
            {imgSize ? `${imgSize.w} × ${imgSize.h} بكسل — ${zoom.toFixed(2)}x` : "جاري التحميل…"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-center bg-black/30 min-h-[40vh] max-h-[75vh] overflow-auto custom-scroll p-4">
          <img
            ref={imgRef}
            src={imageUrl}
            alt={imageName}
            draggable={false}
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "center center",
              transition: "transform 0.15s ease",
              maxWidth: "90vw",
              maxHeight: "70vh",
              objectFit: "contain",
            }}
            className="rounded-lg shadow-2xl"
          />
        </div>

        <div className="shrink-0 px-6 py-3 flex items-center justify-between border-t">
          <span className="text-[10px] text-muted-foreground">
            انقر لزيادة التكبير — استخدم الأزرار للتحكم
          </span>
          <Button
            variant="outline"
            size="sm"
            className="min-h-9"
            onClick={() => {
              const a = document.createElement("a");
              a.href = imageUrl;
              a.download = imageName;
              a.click();
            }}
          >
            <Download className="h-4 w-4 me-1" /> تنزيل
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
