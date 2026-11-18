import clsx from "clsx";

import { Link } from "@/i18n/navigation";

interface DesktopItemProps {
  label: string;
  icon: any;
  href: string;
  onClick?: () => void;
  active?: boolean;
  badge?: number;
}

const itemClass = (active?: boolean) =>
  clsx(
    `
    group
    flex
    gap-x-3
    rounded-md
    p-3
    text-sm
    leading-6
    font-semibold
    text-muted-foreground
    hover:text-foreground
    hover:bg-muted
    `,
    active && "bg-muted text-foreground"
  );

// the count on an item (friend requests waiting), "9+" past 9
const Badge: React.FC<{ count?: number }> = ({ count }) =>
  count ? (
    <span
      aria-hidden="true"
      className="absolute -right-1 -top-1 min-w-[1.125rem] rounded-full bg-rose-500 px-1 text-center text-[10px] font-semibold leading-[1.125rem] text-white">
      {count > 9 ? "9+" : count}
    </span>
  ) : null;

// Items with onClick (log out) are buttons: a locale-aware Link to "#" would
// navigate to /vi#.
const DesktopItem: React.FC<DesktopItemProps> = ({
  label,
  icon: Icon,
  href,
  onClick,
  active,
  badge,
}) => {
  const content = (
    <>
      <span className="relative">
        <Icon className="h-6 w-6 shrink-0" aria-hidden="true" />
        <Badge count={badge} />
      </span>
      <span className="sr-only">{badge ? `${label} (${badge})` : label}</span>
    </>
  );

  return (
    <li key={label}>
      {onClick ? (
        <button type="button" onClick={onClick} title={label} className={itemClass(active)}>
          {content}
        </button>
      ) : (
        <Link href={href} title={label} className={itemClass(active)}>
          {content}
        </Link>
      )}
    </li>
  );
};

export default DesktopItem;
