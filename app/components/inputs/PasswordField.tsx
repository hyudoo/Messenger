"use client";

import clsx from "clsx";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { HiOutlineEye, HiOutlineEyeSlash } from "react-icons/hi2";

// A controlled password input with a show / hide button (for forms outside react-hook-form).
const PasswordField: React.FC<{
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
}> = ({ id, label, value, onChange, autoComplete = "new-password", disabled, invalid, describedBy, autoFocus }) => {
  const t = useTranslations("auth");
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium leading-6 text-foreground">
        {label}
      </label>
      <div className="relative mt-2">
        <input
          id={id}
          type={visible ? "text" : "password"}
          required
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          disabled={disabled}
          value={value}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
          className={clsx(
            "form-input block w-full rounded-md border-0 bg-background py-2 pr-10 text-foreground shadow-sm ring-1 ring-inset ring-input focus:ring-2 focus:ring-inset sm:text-sm sm:leading-6",
            invalid ? "ring-rose-500 focus:ring-rose-500" : "focus:ring-sky-600",
            disabled && "cursor-default opacity-50"
          )}
        />
        <button
          type="button"
          onClick={() => setVisible((shown) => !shown)}
          aria-label={visible ? t("hide_password") : t("show_password")}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600">
          {visible ? <HiOutlineEyeSlash className="h-5 w-5" /> : <HiOutlineEye className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );
};

export default PasswordField;
