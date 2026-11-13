"use client";

import clsx from "clsx";
import { useRef, useState } from "react";
import { toast } from "react-hot-toast";

import { IMAGE_TYPES, uploadImage } from "../libs/upload";

interface ImageUploadButtonProps {
  onUpload: (url: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}

// Opens a file picker and uploads the chosen image to S3; `children` is the trigger.
const ImageUploadButton: React.FC<ImageUploadButtonProps> = ({
  onUpload,
  disabled,
  children,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const isDisabled = disabled || isUploading;

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    setIsUploading(true);
    try {
      onUpload(await uploadImage(file));
    } catch (error: any) {
      toast.error(error?.message || "Tải ảnh lên thất bại");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={Object.keys(IMAGE_TYPES).join(",")}
        className="hidden"
        onChange={handleChange}
      />
      <div
        role="button"
        aria-disabled={isDisabled}
        onClick={() => !isDisabled && inputRef.current?.click()}
        className={clsx(
          "cursor-pointer",
          isDisabled && "cursor-not-allowed opacity-50"
        )}>
        {children}
      </div>
    </>
  );
};

export default ImageUploadButton;
