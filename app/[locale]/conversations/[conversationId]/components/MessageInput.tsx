"use client";

import { useLayoutEffect } from "react";

interface MessageInputProps {
  id: string;
  value: string;
  // the new value and where the caret is
  onChange: (value: string, caret: number) => void;
  // the caret moved without a change (arrows, clicks)
  onCaret?: (caret: number) => void;
  // gets every key first; true = handled (e.g. the mention picker's arrows / Enter)
  onKeyDownFirst?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
  onSubmit: () => void;
  onPaste?: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  // Esc: cancels a reply / edit (only passed while there is one)
  onEscape?: () => void;
  onBlur?: () => void;
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
  onCaret,
  onKeyDownFirst,
  onSubmit,
  onPaste,
  onEscape,
  onBlur,
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
    if (onKeyDownFirst?.(event)) {
      event.preventDefault();
      return;
    }
    if (event.key === "Escape" && onEscape) {
      event.preventDefault();
      onEscape();
      return;
    }
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
        onChange={(event) => onChange(event.target.value, event.target.selectionStart)}
        onSelect={(event) => onCaret?.(event.currentTarget.selectionStart)}
        onKeyDown={handleKeyDown}
        onPaste={onPaste}
        onBlur={onBlur}
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
