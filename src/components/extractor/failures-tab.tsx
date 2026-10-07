"use client";

import { useState } from "react";
import { useExtractorStore } from "@/lib/extractor/store";
import { ImageViewer } from "./image-viewer";
import {
  Button,
  Card,
  CardContent,
  Badge,
  Alert,
  AlertDescription,
  AlertTitle,
  Separator,
} from "@/components/extractor/ui-bundle";
import {
  AlertTriangle,
  Trash2,
  RotateCcw,
  ImageIcon,
  Clock,
  XCircle,
} from "lucide-react";

export function FailuresTab() {
  const failures = useExtractorStore((s) => s.failures);
  const clearFailures = useExtractorStore((s) => s.clearFailures);
  const removeFailure = useExtractorStore((s) => s.removeFailure);
  const retryExtraction = useExtractorStore((s) => s.retryExtraction);
  const images = useExtractorStore((s) => s.images);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [viewerImage, setViewerImage] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerImageName, setViewerImageName] = useState<string>("");

  const openViewer = (dataUrl: string, name: string) => {
    setViewerImage(dataUrl);
    setViewerImageName(name);
    setViewerOpen(true);
  };

  const handleRetry = async (imageId: string, mode: "tables" | "mechanic") => {
    setRetrying(imageId);
    try {
      await retryExtraction(imageId, mode);
    } finally {
      setRetrying(null);
    }
  };

  if (failures.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <XCircle className="h-16 w-16 mb-4 opacity-30" aria-hidden />
        <p className="text-lg font-semibold">لا توجد أفلاس حتى الآن</p>
        <p className="text-sm mt-2">عندما يفشل النموذج في استخراج صورة، تظهر هنا</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
          <h2 className="text-lg font-bold">
            الأفلاس ({failures.length})
          </h2>
          <Badge variant="destructive">{failures.length} صورة</Badge>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (confirm("هل تريد مسح جميع الأفلاس؟")) clearFailures();
          }}
        >
          <Trash2 className="h-4 w-4 me-1" aria-hidden /> مسح الكل
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {failures.map((f) => {
          const img = images.find((i) => i.id === f.imageId);
          const previewUrl = f.imageDataUrl ?? img?.dataUrl;
          const displayName = f.imageName ?? img?.name ?? f.imageId;
          return (
            <Card key={f.imageId + f.timestamp} className="overflow-hidden">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start gap-3">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt={displayName}
                      className="w-20 h-20 object-cover rounded-md border shrink-0 cursor-pointer"
                      title="انقر للمعاينة"
                      onClick={() => previewUrl && openViewer(previewUrl, displayName)}
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-md border bg-muted flex items-center justify-center shrink-0">
                      <ImageIcon className="h-6 w-6 text-muted-foreground" aria-hidden />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">
                      {displayName}
                    </p>
                    <Badge variant="outline" className="text-[10px] mt-0.5">
                      {f.mode === "tables" ? "جداول" : "ميكانيك"}
                    </Badge>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRetry(f.imageId, f.mode)}
                      disabled={retrying === f.imageId}
                    >
                      <RotateCcw className="h-4 w-4 me-1" aria-hidden />
                      {retrying === f.imageId ? "يعيد..." : "إعادة"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeFailure(f.imageId)}
                      className="shrink-0"
                    >
                      <XCircle className="h-4 w-4 text-destructive" aria-hidden />
                    </Button>
                  </div>
                </div>

                <Alert variant="destructive" className="py-1.5">
                  <AlertTitle className="text-[11px]">خطأ الاستخراج</AlertTitle>
                  <AlertDescription className="text-[11px]">
                    {f.error}
                  </AlertDescription>
                </Alert>

                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Clock className="h-3 w-3" aria-hidden />
                  {new Date(f.timestamp).toLocaleString("ar-EG", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Separator />

      {viewerOpen && (
        <ImageViewer
          imageUrl={viewerImage ?? ""}
          imageName={viewerImageName || "صورة"}
          open={viewerOpen}
          onOpenChange={setViewerOpen}
        />
      )}

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>
          💡 عند فشل الاستخراج، اضغط "إعادة" لمحاولة استخراج الصورة مرة أخرى
        </span>
      </div>
    </div>
  );
}
