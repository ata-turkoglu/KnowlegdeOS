"use client";

import type { InputHTMLAttributes } from "react";
import { aTextControlClassName, cx } from "./ui-classes";

export type AFileInputProps = InputHTMLAttributes<HTMLInputElement>;

export function AFileInput({ className, type, ...props }: AFileInputProps) {
  const resolvedClassName = cx(
    "a-file-input p-inputtext block",
    aTextControlClassName,
    className
  );

  return <input {...props} type={type ?? "file"} className={resolvedClassName} />;
}
