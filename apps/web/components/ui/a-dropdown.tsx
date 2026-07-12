"use client";

import { Dropdown, type DropdownProps } from "primereact/dropdown";
import { aControlClassName, aSurfaceFrameClassName, cx } from "./ui-classes";

export type ADropdownProps = DropdownProps;

export function ADropdown({ className, panelClassName, ...props }: ADropdownProps) {
  const resolvedClassName = cx("a-dropdown", aControlClassName, className);

  const resolvedPanelClassName = cx(
    "a-dropdown-panel",
    aSurfaceFrameClassName,
    panelClassName
  );

  return (
    <Dropdown
      {...props}
      className={resolvedClassName}
      panelClassName={resolvedPanelClassName}
      optionLabel={props.optionLabel ?? "label"}
      optionValue={props.optionValue ?? "value"}
    />
  );
}
