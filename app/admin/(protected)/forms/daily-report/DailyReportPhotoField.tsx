"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

type DailyReportPhotoFieldProps = {
  inputName?: string;
};

const MAX_PHOTO_DIMENSION = 1800;
const JPEG_QUALITY = 0.82;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

function readImageDimensions(file: File) {
  return new Promise<{ height: number; width: number }>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new window.Image();

    image.onload = () => {
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
      URL.revokeObjectURL(objectUrl);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Could not read ${file.name}.`));
    };

    image.src = objectUrl;
  });
}

async function compressPhoto(file: File, index: number) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files are supported.");
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error("Each photo must be 10 MB or smaller.");
  }

  const { width, height } = await readImageDimensions(file);

  if (!width || !height) {
    throw new Error(`Could not process ${file.name}.`);
  }

  const scale = Math.min(1, MAX_PHOTO_DIMENSION / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  if (
    scale === 1 &&
    file.size <= 1.5 * 1024 * 1024 &&
    (file.type === "image/jpeg" || file.type === "image/webp")
  ) {
    return file;
  }

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext("2d");

  if (!context) {
    bitmap.close();
    throw new Error("Could not prepare one of the photos.");
  }

  context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
  });

  if (!blob) {
    throw new Error(`Could not compress ${file.name}.`);
  }

  const safeBaseName = file.name.replace(/\.[^.]+$/, "") || `photo-${index + 1}`;

  return new File([blob], `${safeBaseName}.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

export default function DailyReportPhotoField({
  inputName = "photos",
}: DailyReportPhotoFieldProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [photos, setPhotos] = useState<
    Array<{ file: File; id: string; name: string; src: string }>
  >([]);
  const [error, setError] = useState("");
  const [activePhotoIndex, setActivePhotoIndex] = useState<number | null>(null);

  useEffect(() => {
    return () => {
      photos.forEach((photo) => URL.revokeObjectURL(photo.src));
    };
  }, [photos]);

  useEffect(() => {
    if (activePhotoIndex === null) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActivePhotoIndex(null);
        return;
      }

      if (event.key === "ArrowRight") {
        setActivePhotoIndex((currentIndex) => {
          if (currentIndex === null) return currentIndex;
          return (currentIndex + 1) % photos.length;
        });
      }

      if (event.key === "ArrowLeft") {
        setActivePhotoIndex((currentIndex) => {
          if (currentIndex === null) return currentIndex;
          return (currentIndex - 1 + photos.length) % photos.length;
        });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activePhotoIndex, photos.length]);

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const fileList = event.target.files;

    setPhotos((currentPhotos) => {
      currentPhotos.forEach((photo) => URL.revokeObjectURL(photo.src));
      return [];
    });

    if (!fileList || fileList.length === 0) {
      setError("");
      return;
    }

    try {
      const files = Array.from(fileList);
      const compressedFiles = await Promise.all(
        files.map((file, index) => compressPhoto(file, index))
      );
      const dataTransfer = new DataTransfer();

      compressedFiles.forEach((file) => dataTransfer.items.add(file));

      if (inputRef.current) {
        inputRef.current.files = dataTransfer.files;
      }

      setPhotos(
        compressedFiles.map((file, index) => ({
          file,
          id: `${file.name}-${file.lastModified}-${index}`,
          name: file.name,
          src: URL.createObjectURL(file),
        }))
      );
      setActivePhotoIndex(null);
      setError("");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not prepare the selected photos."
      );
    }
  }

  const activePhoto =
    activePhotoIndex !== null ? photos[activePhotoIndex] ?? null : null;
  const canUsePortal = typeof document !== "undefined";

  function syncInputFiles(nextPhotos: Array<{ file: File }>) {
    const dataTransfer = new DataTransfer();
    nextPhotos.forEach((photo) => dataTransfer.items.add(photo.file));

    if (inputRef.current) {
      inputRef.current.files = dataTransfer.files;
    }
  }

  function removePhoto(photoId: string) {
    let nextActiveIndex: number | null = activePhotoIndex;

    setPhotos((currentPhotos) => {
      const removedIndex = currentPhotos.findIndex((photo) => photo.id === photoId);

      if (removedIndex === -1) {
        return currentPhotos;
      }

      const removedPhoto = currentPhotos[removedIndex];
      URL.revokeObjectURL(removedPhoto.src);

      const nextPhotos = currentPhotos.filter((photo) => photo.id !== photoId);
      syncInputFiles(nextPhotos);

      if (nextPhotos.length === 0) {
        nextActiveIndex = null;
      } else if (activePhotoIndex === null) {
        nextActiveIndex = null;
      } else if (removedIndex < activePhotoIndex) {
        nextActiveIndex = activePhotoIndex - 1;
      } else if (removedIndex === activePhotoIndex) {
        nextActiveIndex = Math.min(activePhotoIndex, nextPhotos.length - 1);
      }

      return nextPhotos;
    });

    setActivePhotoIndex(nextActiveIndex);
  }

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor={inputId}
          className="block text-base font-semibold text-slate-900"
        >
          Photos
        </label>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-500 ring-1 ring-slate-200">
          Optional
        </span>
      </div>

      <input
        id={inputId}
        ref={inputRef}
        name={inputName}
        type="file"
        accept="image/*"
        multiple
        onChange={handleChange}
        className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none transition file:mr-4 file:rounded-full file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700 focus:border-slate-900"
      />

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      ) : null}

      {photos.length > 0 ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            <span>
              {photos.length} photo{photos.length === 1 ? "" : "s"} ready to upload.
            </span>
            <button
              type="button"
              onClick={() => setActivePhotoIndex(0)}
              className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
            >
              Review Photos
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
          {photos.map((photo, index) => (
            <div
              key={photo.id}
              className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
            >
              <button
                type="button"
                onClick={() => removePhoto(photo.id)}
                aria-label={`Remove ${photo.name}`}
                className="absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-600 text-base font-semibold text-white shadow transition hover:bg-red-700"
              >
                ×
              </button>

              <button
                type="button"
                onClick={() => setActivePhotoIndex(index)}
                className="block w-full text-left"
              >
                <Image
                  src={photo.src}
                  alt={`Daily report photo ${index + 1}`}
                  width={1200}
                  height={900}
                  unoptimized
                  className="h-40 w-full object-cover"
                />
                <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
                  <span className="truncate">{photo.name}</span>
                  <span className="whitespace-nowrap font-medium text-slate-700">
                    Review
                  </span>
                </div>
              </button>
            </div>
          ))}
        </div>
        </div>
      ) : null}

      {canUsePortal && activePhoto
        ? createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 sm:p-4">
          <button
            type="button"
            aria-label="Close photo review"
            onClick={() => setActivePhotoIndex(null)}
            className="absolute inset-0 cursor-default"
          />

          <div className="relative z-10 flex h-[78vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl sm:h-[82vh]">
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-2.5 sm:px-5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {activePhoto.name}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Photo {activePhotoIndex! + 1} of {photos.length}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setActivePhotoIndex(null)}
                className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-3 sm:p-4">
              <div className="mx-auto flex min-h-full w-full items-start justify-center">
                <Image
                  src={activePhoto.src}
                  alt={activePhoto.name}
                  width={1600}
                  height={1200}
                  unoptimized
                  className="h-auto w-full max-w-full rounded-2xl bg-white object-contain shadow-sm"
                />
              </div>

              {photos.length > 1 ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setActivePhotoIndex((currentIndex) => {
                        if (currentIndex === null) return currentIndex;
                        return (currentIndex - 1 + photos.length) % photos.length;
                      })
                    }
                    className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 px-3 py-2 text-sm font-medium text-slate-800 shadow transition hover:bg-white"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setActivePhotoIndex((currentIndex) => {
                        if (currentIndex === null) return currentIndex;
                        return (currentIndex + 1) % photos.length;
                      })
                    }
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 px-3 py-2 text-sm font-medium text-slate-800 shadow transition hover:bg-white"
                  >
                    Next
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>,
        document.body
      )
        : null}
    </section>
  );
}
