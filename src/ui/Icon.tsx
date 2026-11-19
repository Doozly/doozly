import checkCircleFill from "@phosphor-icons/core/fill/check-circle-fill.svg?raw";
import starFill from "@phosphor-icons/core/fill/star-fill.svg?raw";
import arrowLeft from "@phosphor-icons/core/regular/arrow-left.svg?raw";
import arrowsDownUp from "@phosphor-icons/core/regular/arrows-down-up.svg?raw";
import bell from "@phosphor-icons/core/regular/bell.svg?raw";
import calendarBlank from "@phosphor-icons/core/regular/calendar-blank.svg?raw";
import calendarDots from "@phosphor-icons/core/regular/calendar-dots.svg?raw";
import caretDown from "@phosphor-icons/core/regular/caret-down.svg?raw";
import caretRight from "@phosphor-icons/core/regular/caret-right.svg?raw";
import check from "@phosphor-icons/core/regular/check.svg?raw";
import checkCircle from "@phosphor-icons/core/regular/check-circle.svg?raw";
import circle from "@phosphor-icons/core/regular/circle.svg?raw";
import cloudCheck from "@phosphor-icons/core/regular/cloud-check.svg?raw";
import cloudSlash from "@phosphor-icons/core/regular/cloud-slash.svg?raw";
import copy from "@phosphor-icons/core/regular/copy.svg?raw";
import dotsThree from "@phosphor-icons/core/regular/dots-three.svg?raw";
import folderSimple from "@phosphor-icons/core/regular/folder-simple.svg?raw";
import folderSimplePlus from "@phosphor-icons/core/regular/folder-simple-plus.svg?raw";
import gear from "@phosphor-icons/core/regular/gear.svg?raw";
import house from "@phosphor-icons/core/regular/house.svg?raw";
import infinity from "@phosphor-icons/core/regular/infinity.svg?raw";
import lightbulb from "@phosphor-icons/core/regular/lightbulb.svg?raw";
import list from "@phosphor-icons/core/regular/list.svg?raw";
import listBullets from "@phosphor-icons/core/regular/list-bullets.svg?raw";
import magnifyingGlass from "@phosphor-icons/core/regular/magnifying-glass.svg?raw";
import note from "@phosphor-icons/core/regular/note.svg?raw";
import palette from "@phosphor-icons/core/regular/palette.svg?raw";
import paperclip from "@phosphor-icons/core/regular/paperclip.svg?raw";
import pencilSimple from "@phosphor-icons/core/regular/pencil-simple.svg?raw";
import plus from "@phosphor-icons/core/regular/plus.svg?raw";
import printer from "@phosphor-icons/core/regular/printer.svg?raw";
import repeat from "@phosphor-icons/core/regular/repeat.svg?raw";
import shareNetwork from "@phosphor-icons/core/regular/share-network.svg?raw";
import sidebarSimple from "@phosphor-icons/core/regular/sidebar-simple.svg?raw";
import signOut from "@phosphor-icons/core/regular/sign-out.svg?raw";
import squaresFour from "@phosphor-icons/core/regular/squares-four.svg?raw";
import star from "@phosphor-icons/core/regular/star.svg?raw";
import sun from "@phosphor-icons/core/regular/sun.svg?raw";
import trash from "@phosphor-icons/core/regular/trash.svg?raw";
import userCircle from "@phosphor-icons/core/regular/user-circle.svg?raw";
import warning from "@phosphor-icons/core/regular/warning.svg?raw";
import x from "@phosphor-icons/core/regular/x.svg?raw";
import type { SVGProps } from "react";

// Named by what they mean in the app, so swapping the icon set touches only this file
const regular = {
  myDay: sun,
  important: star,
  planned: calendarDots,
  allTasks: infinity,
  tasks: house,
  list: listBullets,
  group: folderSimple,
  newGroup: folderSimplePlus,
  add: plus,
  incomplete: circle,
  complete: checkCircle,
  check,
  delete: trash,
  reminder: bell,
  dueDate: calendarBlank,
  repeat,
  attach: paperclip,
  note,
  search: magnifyingGlass,
  settings: gear,
  sort: arrowsDownUp,
  groupBy: squaresFour,
  theme: palette,
  more: dotsThree,
  chevronRight: caretRight,
  chevronDown: caretDown,
  back: arrowLeft,
  close: x,
  menu: list,
  sidebar: sidebarSimple,
  suggestions: lightbulb,
  duplicate: copy,
  rename: pencilSimple,
  print: printer,
  share: shareNetwork,
  account: userCircle,
  signOut,
  synced: cloudCheck,
  offline: cloudSlash,
  warning,
};

export type IconName = keyof typeof regular;

// Only the filled ones we actually show, every weight would cost bundle size for nothing
const filled: Partial<Record<IconName, string>> = {
  important: starFill,
  complete: checkCircleFill,
};

export const iconNames = Object.keys(regular) as IconName[];

const inner = (svg: string) => svg.replace(/^<svg[^>]*>|<\/svg>\s*$/g, "");

type IconProps = Omit<
  SVGProps<SVGSVGElement>,
  "children" | "dangerouslySetInnerHTML"
> & {
  name: IconName;
  filled?: boolean;
  size?: number;
  /** Leave out for decorative icons, they're hidden from screen readers then */
  label?: string;
};

export function Icon({
  name,
  filled: wantFilled = false,
  size = 20,
  label,
  ...rest
}: IconProps) {
  const svg = (wantFilled && filled[name]) || regular[name];
  return (
    <svg
      viewBox="0 0 256 256"
      width={size}
      height={size}
      fill="currentColor"
      focusable="false"
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": true })}
      {...rest}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: static Phosphor SVGs from the bundle, never user input
      dangerouslySetInnerHTML={{ __html: inner(svg) }}
    />
  );
}
