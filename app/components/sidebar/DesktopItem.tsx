import clsx from "clsx";

import { Link } from "@/i18n/navigation";

interface DesktopItemProps {
  label: string;
  icon: any;
  href: string;
  onClick?: () => void;
  active?: boolean;
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

// Items with onClick (log out) are buttons: a locale-aware Link to "#" would
// navigate to /vi#.
const DesktopItem: React.FC<DesktopItemProps> = ({
  label,
  icon: Icon,
  href,
  onClick,
  active,
}) => {
  const content = (
    <>
      <Icon className="h-6 w-6 shrink-0" aria-hidden="true" />
      <span className="sr-only">{label}</span>
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
