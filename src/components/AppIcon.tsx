import type { CSSProperties } from "react";
import {
  IconArrowsMaximize,
  IconBeach,
  IconChartDots,
  IconCurrencyDollar,
  IconCalendarStats,
  IconCalculator,
  IconArrowsExchange,
  IconChevronLeft,
  IconChevronRight,
  IconChevronDown,
  IconCheck,
  IconDots,
  IconMinus,
  IconPencil,
  IconPigMoney,
  IconRepeat,
  IconPlus,
  IconSettings,
  IconSparkles,
  IconTrash,
  IconWallet,
  IconX,
} from "@tabler/icons-react";

export type AppIconName =
  | "add"
  | "beach"
  | "chart"
  | "calculator"
  | "currency"
  | "dollar"
  | "yearSummary"
  | "check"
  | "chevronDown"
  | "chevronLeft"
  | "chevronRight"
  | "close"
  | "delete"
  | "dots"
  | "edit"
  | "expand"
  | "piggyBank"
  | "recurring"
  | "remove"
  | "settings"
  | "sparkles"
  | "wallet";

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
    case "beach":
      return <IconBeach {...commonProps} />;
    case "calculator":
      return <IconCalculator {...commonProps} />;
    case "chart":
      return <IconChartDots {...commonProps} />;
    case "currency":
      return <IconArrowsExchange {...commonProps} />;
    case "dollar":
      return <IconCurrencyDollar {...commonProps} />;
    case "yearSummary":
      return <IconCalendarStats {...commonProps} />;
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
    case "piggyBank":
      return <IconPigMoney {...commonProps} />;
    case "recurring":
      return <IconRepeat {...commonProps} />;
    case "remove":
      return <IconMinus {...commonProps} />;
    case "settings":
      return <IconSettings {...commonProps} />;
    case "sparkles":
      return <IconSparkles {...commonProps} />;
    case "wallet":
      return <IconWallet {...commonProps} />;
    default:
      return null;
  }
}
