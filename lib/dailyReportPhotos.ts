import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export const DAILY_REPORT_PHOTO_BUCKET = "daily-report-photos";

export type DailyReportStoredPhoto = {
  name: string;
  path: string;
};

type ParsedDailyReportPhoto =
  | {
      key: string;
      kind: "inline";
      name: string | null;
      src: string;
    }
  | {
      key: string;
      kind: "stored";
      name: string | null;
      path: string;
    };

export type ResolvedDailyReportPhoto = {
  key: string;
  name: string | null;
  src: string;
};

function sanitizePhotoFileName(name: string, index: number) {
  const trimmed = name.trim();
  const extensionMatch = trimmed.match(/\.([a-z0-9]+)$/i);
  const extension = extensionMatch?.[1]?.toLowerCase() ?? "jpg";
  const baseName = trimmed
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${baseName || `photo-${index + 1}`}-${index + 1}.${extension}`;
}

function parseDailyReportPhotos(value: unknown) {
  if (!Array.isArray(value)) return [] as ParsedDailyReportPhoto[];

  return value.reduce<ParsedDailyReportPhoto[]>((photos, item, index) => {
    if (typeof item === "string") {
      const trimmed = item.trim();

      if (!trimmed) return photos;

      if (trimmed.startsWith("data:image/")) {
        photos.push({
          key: `inline-${index}`,
          kind: "inline",
          name: null,
          src: trimmed,
        });
        return photos;
      }

      photos.push({
        key: `stored-${trimmed}`,
        kind: "stored",
        name: trimmed.split("/").pop() ?? null,
        path: trimmed,
      });
      return photos;
    }

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return photos;
    }

    const candidate = item as Record<string, unknown>;
    const path =
      typeof candidate.path === "string" ? candidate.path.trim() : "";

    if (!path) return photos;

    const name =
      typeof candidate.name === "string" && candidate.name.trim()
        ? candidate.name.trim()
        : path.split("/").pop() ?? null;

    photos.push({
      key: `stored-${path}`,
      kind: "stored",
      name,
      path,
    });

    return photos;
  }, []);
}

function isPhotoFile(value: FormDataEntryValue): value is File {
  return typeof File !== "undefined" && value instanceof File && value.size > 0;
}

export async function uploadDailyReportPhotos(
  reportId: string,
  values: FormDataEntryValue[]
) {
  const files = values.filter(isPhotoFile).filter((file) => file.type.startsWith("image/"));

  if (files.length === 0) {
    return [] as DailyReportStoredPhoto[];
  }

  const supabaseAdmin = createAdminClient();
  const uploadedPaths: string[] = [];

  try {
    const storedPhotos: DailyReportStoredPhoto[] = [];

    for (const [index, file] of files.entries()) {
      const fileName = sanitizePhotoFileName(file.name, index);
      const path = `daily-reports/${reportId}/${fileName}`;

      const { error } = await supabaseAdmin.storage
        .from(DAILY_REPORT_PHOTO_BUCKET)
        .upload(path, file, {
          contentType: file.type || undefined,
          upsert: false,
        });

      if (error) {
        throw new Error(error.message);
      }

      uploadedPaths.push(path);
      storedPhotos.push({
        name: file.name || fileName,
        path,
      });
    }

    return storedPhotos;
  } catch (error) {
    if (uploadedPaths.length > 0) {
      await supabaseAdmin.storage
        .from(DAILY_REPORT_PHOTO_BUCKET)
        .remove(uploadedPaths);
    }

    throw error;
  }
}

export async function removeDailyReportPhotos(paths: string[]) {
  if (paths.length === 0) return;

  const supabaseAdmin = createAdminClient();
  await supabaseAdmin.storage.from(DAILY_REPORT_PHOTO_BUCKET).remove(paths);
}

export async function resolveDailyReportPhotos(value: unknown) {
  const parsedPhotos = parseDailyReportPhotos(value);

  if (parsedPhotos.length === 0) {
    return [] as ResolvedDailyReportPhoto[];
  }

  const storedPhotos = parsedPhotos.filter(
    (photo): photo is Extract<ParsedDailyReportPhoto, { kind: "stored" }> =>
      photo.kind === "stored"
  );

  const resolvedStoredPhotos = new Map<string, string>();

  if (storedPhotos.length > 0) {
    const supabaseAdmin = createAdminClient();
    const { data, error } = await supabaseAdmin.storage
      .from(DAILY_REPORT_PHOTO_BUCKET)
      .createSignedUrls(
        storedPhotos.map((photo) => photo.path),
        60 * 60
      );

    if (!error && data) {
      data.forEach((item, index) => {
        const path = storedPhotos[index]?.path;
        if (path && item.signedUrl) {
          resolvedStoredPhotos.set(path, item.signedUrl);
        }
      });
    }
  }

  return parsedPhotos.flatMap((photo) => {
    if (photo.kind === "inline") {
      return [
        {
          key: photo.key,
          name: photo.name,
          src: photo.src,
        },
      ];
    }

    const signedUrl = resolvedStoredPhotos.get(photo.path);

    if (!signedUrl) {
      return [];
    }

    return [
      {
        key: photo.key,
        name: photo.name,
        src: signedUrl,
      },
    ];
  });
}
