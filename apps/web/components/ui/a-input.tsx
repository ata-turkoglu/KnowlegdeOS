"use client";

import { InputText, type InputTextProps } from "primereact/inputtext";
import { aTextControlClassName, cx } from "./ui-classes";

export type AInputProps = InputTextProps;

export function AInput({ className, ...props }: AInputProps) {
  const resolvedClassName = cx("a-input", aTextControlClassName, className);

  return <InputText {...props} className={resolvedClassName} />;
}
