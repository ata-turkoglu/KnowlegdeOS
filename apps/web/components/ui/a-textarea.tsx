"use client";

import { InputTextarea, type InputTextareaProps } from "primereact/inputtextarea";
import { aTextControlClassName, cx } from "./ui-classes";

export type ATextareaProps = InputTextareaProps;

export function ATextarea({ className, rows = 8, ...props }: ATextareaProps) {
  const resolvedClassName = cx("a-textarea", aTextControlClassName, className);

  return <InputTextarea {...props} rows={rows} className={resolvedClassName} />;
}
