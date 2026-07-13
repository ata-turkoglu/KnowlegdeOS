"use client";

import { TabMenu, type TabMenuProps } from "primereact/tabmenu";
import { cx } from "./ui-classes";

export type ATabMenuProps = TabMenuProps;

export function ATabMenu({ className, ...props }: ATabMenuProps) {
  return <TabMenu {...props} className={cx("a-tab-menu", className)} />;
}
