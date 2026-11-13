import clsx from "clsx";

import { Link } from "@/i18n/navigation";

interface MobileItemProps {
  href: string;
  label: string;
  icon: any;
  active?: boolean;
  onClick?: () => void;
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

// Items with onClick (log out) are buttons: a locale-aware Link to "#" would
// navigate to /vi#.
const MobileItem: React.FC<MobileItemProps> = ({
  href,
  label,
  icon: Icon,
  active,
  onClick,
}) => {
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-label={label} className={itemClass(active)}>
        <Icon className="h-6 w-6" />
      </button>
    );
  }
  return (
    <Link href={href} aria-label={label} className={itemClass(active)}>
      <Icon className="h-6 w-6" />
    </Link>
  );
};

export default MobileItem;
