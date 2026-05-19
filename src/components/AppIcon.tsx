import type { CSSProperties } from "react";
import {
  IconArrowsMaximize,
  IconChevronLeft,
  IconChevronRight,
  IconChevronDown,
  IconCheck,
  IconDots,
  IconMinus,
  IconPencil,
  IconPlus,
  IconSettings,
  IconTrash,
  IconX,
} from "@tabler/icons-react";

export type AppIconName =
  | "add"
  | "check"
  | "chevronDown"
  | "chevronLeft"
  | "chevronRight"
  | "close"
  | "delete"
  | "dots"
  | "edit"
  | "expand"
  | "remove"
  | "settings";

type AppIconProps = {
  name: AppIconName;
  size?: number;
  stroke?: number;
  style?: CSSProperties;
};

export function AppIcon({ name, size = 16, stroke = 1.8, style }: AppIconProps) {
  const commonProps = {
    size,
    stroke,
    "aria-hidden": true as const,
    style,
  };

  switch (name) {
    case "add":
      return <IconPlus {...commonProps} />;
    case "check":
      return <IconCheck {...commonProps} />;
    case "chevronDown":
      return <IconChevronDown {...commonProps} />;
    case "chevronLeft":
      return <IconChevronLeft {...commonProps} />;
    case "chevronRight":
      return <IconChevronRight {...commonProps} />;
    case "close":
      return <IconX {...commonProps} />;
    case "delete":
      return <IconTrash {...commonProps} />;
    case "dots":
      return <IconDots {...commonProps} />;
    case "edit":
      return <IconPencil {...commonProps} />;
    case "expand":
      return <IconArrowsMaximize {...commonProps} />;
    case "remove":
      return <IconMinus {...commonProps} />;
    case "settings":
      return <IconSettings {...commonProps} />;
    default:
      return null;
  }
}
