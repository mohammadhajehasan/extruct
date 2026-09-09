"use client";

import { useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { parseCsvSimple } from "@/lib/extractor/store";

interface CsvGridProps {
  csv: string;
  maxHeight?: string;
  onCellClick?: (rowIdx: number, colIdx: number, value: string) => void;
}

/** شبكة عرض من نص CSV — خلايا UNCLEAR تُميّز بالكهرماني */
export function CsvGrid({ csv, maxHeight, onCellClick }: CsvGridProps) {
  const grid = useMemo(() => parseCsvSimple(csv), [csv]);
  if (grid.length === 0) {
    return <p className="text-sm text-muted-foreground p-4 text-center">لا توجد بيانات</p>;
  }
  const [header, ...body] = grid;
  return (
    <div
      className={`overflow-auto custom-scroll ${maxHeight ?? "max-h-96"}`}
      dir="ltr"
    >
      <Table>
        <TableHeader className="sticky top-0 bg-card z-10">
          <TableRow>
            {header.map((h, i) => (
              <TableHead key={i} className="whitespace-nowrap border-b bg-muted/60 font-bold">
                {h || "\u00A0"}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {body.map((row, ri) => (
            <TableRow key={ri}>
              {row.map((cell, ci) => {
                const isUnclear = cell.trim().toUpperCase() === "UNCLEAR";
                return (
                  <TableCell
                    key={ci}
                    onClick={
                      onCellClick ? () => onCellClick(ri + 1, ci, cell) : undefined
                    }
                    className={`whitespace-nowrap text-xs border-b ${
                      isUnclear
                        ? "bg-tertiary/20 text-tertiary font-semibold"
                        : ""
                    } ${onCellClick ? "cursor-pointer hover:bg-accent/60" : ""}`}
                  >
                    {cell || "\u00A0"}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
