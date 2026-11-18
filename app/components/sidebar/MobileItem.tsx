import clsx from "clsx";

import { Link } from "@/i18n/navigation";

interface MobileItemProps {
  href: string;
  label: string;
  icon: any;
  active?: boolean;
  onClick?: () => void;
  badge?: number;
}

const itemClass = (active?: boolean) =>
  clsx(
    `
    group
    flex
    gap-x-3
    text-sm
    leading-6
    font-semibold
    w-full
    justify-center
    p-4
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
const MobileItem: React.FC<MobileItemProps> = ({
  href,
  label,
  icon: Icon,
  active,
  onClick,
  badge,
}) => {
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-label={label} className={itemClass(active)}>
        <Icon className="h-6 w-6" />
      </button>
    );
  }
  return (
    <Link href={href} aria-label={badge ? `${label} (${badge})` : label} className={itemClass(active)}>
      <span className="relative">
        <Icon className="h-6 w-6" />
        <Badge count={badge} />
      </span>
    </Link>
  );
};

export default MobileItem;
