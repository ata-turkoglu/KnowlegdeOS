"use client";

import { Dialog, type DialogProps } from "primereact/dialog";
import { cx } from "./ui-classes";

export type ADialogProps = DialogProps;

export function ADialog({ children, className, ...props }: ADialogProps) {
  return (
    <Dialog {...props} className={cx("a-dialog", className)}>
      <div className="a-dialog-content">{children}</div>
    </Dialog>
  );
}
