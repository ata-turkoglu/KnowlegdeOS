"use client";

import { useId, useState, type ChangeEvent, type InputHTMLAttributes } from "react";
import { cx } from "./ui-classes";

export type AFileInputProps = InputHTMLAttributes<HTMLInputElement> & {
  chooseLabel?: string;
  emptyLabel?: string;
  multipleSelectedLabel?: (count: number) => string;
};

export function AFileInput({ className, type, chooseLabel = "Choose file", emptyLabel = "No file selected", multipleSelectedLabel, onChange, ...props }: AFileInputProps) {
  const inputId = useId();
  const [fileNames, setFileNames] = useState<string[]>([]);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    setFileNames(files.map((file) => file.name));
    onChange?.(event);
  }

  const selectionLabel = fileNames.length === 0
    ? emptyLabel
    : fileNames.length === 1
      ? fileNames[0]
      : multipleSelectedLabel?.(fileNames.length) ?? `${fileNames.length} files selected`;

  return <div className={cx("a-file-input", className)}>
    <input {...props} id={inputId} type={type ?? "file"} className="a-file-input__native" onChange={handleChange} />
    <label htmlFor={inputId} className="a-file-input__button">{chooseLabel}</label>
    <span className="a-file-input__selection" title={fileNames.join(", ")}>{selectionLabel}</span>
  </div>;
}
