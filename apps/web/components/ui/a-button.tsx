"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { aButtonBaseClassName, cx } from "./ui-classes";

type AButtonTone = "primary" | "secondary";

export type AButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  tone?: AButtonTone;
};

export function AButton({
  children,
  tone = "primary",
  className,
  type = "button",
  ...props
}: AButtonProps) {
  const resolvedClassName = cx(
    "a-button p-button p-component",
    tone === "secondary" && "p-button-secondary",
    aButtonBaseClassName,
    className
  );

  return (
    <button {...props} type={type} className={resolvedClassName}>
      {children}
    </button>
  );
}
