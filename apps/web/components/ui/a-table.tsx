"use client";

import {
  DataTable,
  type DataTableProps,
  type DataTableValueArray
} from "primereact/datatable";
import { aSurfaceFrameClassName, cx } from "./ui-classes";

export type ATableProps<TValue extends DataTableValueArray> = DataTableProps<TValue>;

export function ATable<TValue extends DataTableValueArray>({
  className,
  ...props
}: ATableProps<TValue>) {
  const resolvedClassName = cx(
    "a-table overflow-hidden",
    aSurfaceFrameClassName,
    className
  );

  return <DataTable {...props} className={resolvedClassName} />;
}
