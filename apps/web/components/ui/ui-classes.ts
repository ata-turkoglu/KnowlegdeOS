export function cx(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(" ");
}

export const aControlClassName = "w-full";

export const aTextControlClassName = aControlClassName;

export const aSurfaceFrameClassName = "";

export const aButtonBaseClassName = "";
