"use client";

import ReactSelect from "react-select";

interface SelectProps {
  label: string;
  value?: Record<string, any>;
  onChange: (value: Record<string, any>) => void;
  options: Record<string, any>[];
  disabled?: boolean;
}

const Select: React.FC<SelectProps> = ({
  label,
  value,
  onChange,
  options,
  disabled,
}) => {
  return (
    <div className="z-[100]">
      <label
        className="
             block
             text-sm
             font-medium
             leading-6
             text-foreground">
        {label}
      </label>
      <div className="mt-2">
        <ReactSelect
          isDisabled={disabled}
          value={value}
          onChange={onChange}
          isMulti
          options={options}
          menuPortalTarget={document.body}
          styles={{
            menuPortal: (base) => ({ ...base, zIndex: 9999 }),
          }}
          // theme tokens, so the menu and chips follow light / dark mode
          classNames={{
            control: () => "text-sm !bg-background !border-input",
            menu: () => "!bg-background border border-border",
            option: ({ isFocused }) =>
              isFocused ? "!bg-muted !text-foreground" : "!bg-background !text-foreground",
            multiValue: () => "!bg-muted",
            multiValueLabel: () => "!text-foreground",
            input: () => "!text-foreground",
            placeholder: () => "!text-muted-foreground",
          }}
        />
      </div>
    </div>
  );
};

export default Select;
