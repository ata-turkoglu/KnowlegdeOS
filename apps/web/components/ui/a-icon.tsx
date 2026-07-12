import { Tooltip } from "primereact/tooltip";
import { useId, type ReactNode } from "react";

type AIconProps = {
  icon: ReactNode;
  tooltip: string;
  className?: string;
};

/**
 * An icon wrapper that exposes its label on hover and keyboard focus.
 */
export function AIcon({ icon, tooltip, className }: AIconProps) {
  const tooltipTargetClass = `a-icon-tooltip-${useId().replace(/:/g, "")}`;

  return (
    <>
      <span className={["a-icon", tooltipTargetClass, className].filter(Boolean).join(" ")}>
        <span className="a-icon__glyph" aria-hidden="true">
          {icon}
        </span>
      </span>
      <Tooltip target={`.${tooltipTargetClass}`} content={tooltip} position="right" />
    </>
  );
}
