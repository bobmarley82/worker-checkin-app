"use client";

import Image from "next/image";
import { useId, useState } from "react";

type DailyReportPhotoFieldProps = {
  inputName?: string;
};

export default function DailyReportPhotoField({
  inputName = "photo_data_json",
}: DailyReportPhotoFieldProps) {
  const inputId = useId();
  const [photos, setPhotos] = useState<string[]>([]);
  const [error, setError] = useState("");

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const fileList = event.target.files;

    if (!fileList || fileList.length === 0) {
      setPhotos([]);
      setError("");
      return;
    }

    try {
      const files = Array.from(fileList);
      const photoData = await Promise.all(
        files.map(
          (file) =>
            new Promise<string>((resolve, reject) => {
              if (!file.type.startsWith("image/")) {
                reject(new Error("Only image files are supported."));
                return;
              }

              const reader = new FileReader();

              reader.onload = () => {
                if (typeof reader.result === "string") {
                  resolve(reader.result);
                } else {
                  reject(new Error("Could not read one of the images."));
                }
              };

              reader.onerror = () => {
                reject(new Error("Could not read one of the images."));
              };

              reader.readAsDataURL(file);
            })
        )
      );

      setPhotos(photoData);
      setError("");
    } catch (caughtError) {
      setPhotos([]);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not prepare the selected photos."
      );
    }
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
        type="file"
        accept="image/*"
        multiple
        onChange={handleChange}
        className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none transition file:mr-4 file:rounded-full file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700 focus:border-slate-900"
      />

      <input type="hidden" name={inputName} value={JSON.stringify(photos)} />

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      ) : null}

      {photos.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {photos.map((photo, index) => (
            <div
              key={`${index}-${photo.slice(0, 32)}`}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
            >
              <Image
                src={photo}
                alt={`Daily report photo ${index + 1}`}
                width={1200}
                height={900}
                unoptimized
                className="h-40 w-full object-cover"
              />
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
