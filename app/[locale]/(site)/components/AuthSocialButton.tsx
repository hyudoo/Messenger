import { IconType } from "react-icons";

interface AuthSocialButtonProps {
  icon: IconType;
  // the provider's name (a brand, the same in every language)
  label: string;
  disabled?: boolean;
  onClick: () => void;
}

const AuthSocialButton: React.FC<AuthSocialButtonProps> = ({
  icon: Icon,
  label,
  disabled,
  onClick,
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="
        inline-flex
        h-10
        w-full
        items-center
        justify-center
        gap-2
        rounded-md
        border
        border-border
        bg-background
        px-4
        text-sm
        font-medium
        text-foreground
        transition-colors
        hover:bg-muted
        focus-visible:outline
        focus-visible:outline-2
        focus-visible:outline-offset-2
        focus-visible:outline-sky-600
        disabled:cursor-default
        disabled:opacity-50
     ">
      <Icon size={16} aria-hidden />
      {label}
    </button>
  );
};

export default AuthSocialButton;
