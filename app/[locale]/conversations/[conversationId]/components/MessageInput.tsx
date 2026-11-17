"use client";

import { useLayoutEffect } from "react";

interface MessageInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onPaste?: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  ref: React.RefObject<HTMLTextAreaElement | null>;
}

// grows with its content up to about five lines, then scrolls
const MAX_HEIGHT_PX = 128;

// The composer: Enter sends, Shift+Enter starts a new line. Enter while an input method is
// composing (e.g. a Vietnamese or Japanese IME) only confirms the composition.
const MessageInput: React.FC<MessageInputProps> = ({
  id,
  value,
  onChange,
  onSubmit,
  onPaste,
  placeholder,
  ref,
}) => {
  useLayoutEffect(() => {
    const textarea = ref.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value, ref]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      event.keyCode !== 229 // Safari reports composition this way
    ) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="relative w-full">
      <textarea
        id={id}
        ref={ref}
        rows={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={onPaste}
        autoComplete="off"
        aria-label={placeholder}
        placeholder={placeholder}
        className="
            block
            text-foreground
            font-light
            py-2
            px-4
            bg-muted
            w-full
            resize-none
            rounded-2xl
            border-0
            leading-6
            focus:outline-none
            focus:ring-0
        "
      />
    </div>
  );
};

export default MessageInput;
