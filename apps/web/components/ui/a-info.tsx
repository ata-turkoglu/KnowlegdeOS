"use client";

import { Tooltip } from "primereact/tooltip";
import { useId } from "react";

type AInfoProps = {
  description: string;
  className?: string;
  position?: "top" | "bottom" | "left" | "right";
};

/** A compact information icon with an accessible hover and focus tooltip. */
export function AInfo({ description, className, position = "top" }: AInfoProps) {
  const tooltipTargetClass = `a-info-tooltip-${useId().replace(/:/g, "")}`;

  return (
    <>
      <button
        type="button"
        className={["a-info", tooltipTargetClass, className].filter(Boolean).join(" ")}
        aria-label={description}
      >
        <i className="pi pi-info-circle" aria-hidden="true" />
      </button>
      <Tooltip target={`.${tooltipTargetClass}`} content={description} position={position} />
    </>
  );
}
