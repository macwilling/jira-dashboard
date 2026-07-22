import { getAccessToken } from "@/lib/google/client";

/**
 * Google Drive REST helpers (files.list / upload / download). Rides the same
 * OAuth refresh token as Tasks/Calendar — requires the `drive` scope, so the
 * Google account must be re-connected in /settings after that scope was added.
 */

const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";

export interface DriveEntry {
  id: string;
  name: string;
  mimeType: string;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

export function isFolder(entry: DriveEntry): boolean {
  return entry.mimeType === FOLDER_MIME;
}

export async function listChildren(folderId: string): Promise<DriveEntry[]> {
  const token = await getAccessToken();
  const entries: DriveEntry[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType)",
      pageSize: "1000",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`${FILES_URL}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Drive list failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      files?: DriveEntry[];
      nextPageToken?: string;
    };
    entries.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return entries;
}

export async function createTextFile(
  parentId: string,
  name: string,
  content: string,
  mimeType = "text/markdown",
): Promise<string> {
  const token = await getAccessToken();

  const boundary = "-------drive-multipart-boundary";
  const metadata = JSON.stringify({ name, parents: [parentId], mimeType });
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}; charset=UTF-8\r\n\r\n${content}\r\n` +
    `--${boundary}--`;

  const res = await fetch(`${UPLOAD_URL}?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Drive create failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function updateTextFile(
  fileId: string,
  content: string,
  mimeType = "text/markdown",
): Promise<void> {
  const token = await getAccessToken();
  const res = await fetch(
    `${UPLOAD_URL}/${encodeURIComponent(fileId)}?uploadType=media`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `${mimeType}; charset=UTF-8`,
      },
      body: content,
    },
  );
  if (!res.ok) {
    throw new Error(`Drive update failed: ${res.status} ${await res.text()}`);
  }
}

export async function getTextFile(fileId: string): Promise<string> {
  const token = await getAccessToken();
  const res = await fetch(
    `${FILES_URL}/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (!res.ok) {
    throw new Error(`Drive download failed: ${res.status} ${await res.text()}`);
  }
  return res.text();
}

/**
 * Recursively walks a Drive folder and returns vault-relative note paths
 * ("Folder/Sub/Note", no .md extension) for every markdown file. Dot-folders
 * (.obsidian, .claude) and any folder id in `skipFolderIds` are skipped.
 */
export async function walkMarkdownTree(
  rootFolderId: string,
  skipFolderIds: string[] = [],
): Promise<string[]> {
  const paths: string[] = [];
  const queue: { id: string; prefix: string }[] = [
    { id: rootFolderId, prefix: "" },
  ];

  while (queue.length > 0) {
    const { id, prefix } = queue.shift()!;
    const children = await listChildren(id);
    for (const child of children) {
      if (isFolder(child)) {
        if (child.name.startsWith(".") || skipFolderIds.includes(child.id)) {
          continue;
        }
        queue.push({ id: child.id, prefix: `${prefix}${child.name}/` });
      } else if (child.name.endsWith(".md")) {
        paths.push(`${prefix}${child.name.slice(0, -3)}`);
      }
    }
  }

  return paths.sort();
}
