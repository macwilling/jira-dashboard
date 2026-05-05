"use client";

import { useState, useRef, useCallback } from "react";
import { AppShell } from "@/components/app-shell/AppShell";
import { Upload, Copy, Check, RefreshCw, FileIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileItem {
  key: string;
  name: string;
  size: number;
  lastModified: string | null;
  url: string;
}

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function FilesPage() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/files");
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error ?? "Failed to load files");
      }
      const { files } = await res.json();
      setFiles(files);
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      // Get presigned URL
      const presignRes = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type || "application/octet-stream" }),
      });
      if (!presignRes.ok) {
        const { error } = await presignRes.json();
        throw new Error(error ?? "Failed to get upload URL");
      }
      const { uploadUrl, publicUrl } = await presignRes.json();

      // Upload directly to S3
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!uploadRes.ok) throw new Error("Upload to S3 failed");

      // Copy URL to clipboard
      await navigator.clipboard.writeText(publicUrl).catch(() => {});

      // Refresh list
      await load();
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [load]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  };

  const copyUrl = async (url: string, key: string) => {
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <AppShell title="Files">
      {/* Toolbar */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b px-4 py-2 flex items-center gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className={cn(
            "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium transition-colors",
            "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          )}
        >
          {uploading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          {uploading ? "Uploading…" : "Upload file"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileChange}
        />

        {!loaded && (
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium border hover:bg-muted transition-colors disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Load files
          </button>
        )}

        {loaded && (
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 h-8 w-8 rounded-md border hover:bg-muted transition-colors disabled:opacity-50 justify-center"
            title="Refresh"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        )}

        {uploadError && (
          <span className="text-xs text-destructive ml-2">{uploadError}</span>
        )}
      </div>

      <main className="px-4 py-4 max-w-4xl mx-auto">
        {error && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {!loaded && !loading && !error && (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground text-sm gap-2">
            <FileIcon className="h-8 w-8 opacity-30" />
            <p>Click <strong>Load files</strong> to list the bucket, or upload a file directly.</p>
          </div>
        )}

        {loading && !loaded && (
          <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        )}

        {loaded && files.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground text-sm gap-2">
            <FileIcon className="h-8 w-8 opacity-30" />
            <p>No files in this bucket.</p>
          </div>
        )}

        {files.length > 0 && (
          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <th className="text-left px-3 py-2 font-medium">Name</th>
                  <th className="text-right px-3 py-2 font-medium w-20">Size</th>
                  <th className="text-left px-3 py-2 font-medium w-32">Modified</th>
                  <th className="px-3 py-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {files.map((file, i) => (
                  <tr
                    key={file.key}
                    className={cn(
                      "hover:bg-muted/30 transition-colors",
                      i < files.length - 1 && "border-b"
                    )}
                  >
                    <td className="px-3 py-2">
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium hover:underline text-foreground"
                      >
                        {file.name}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                      {formatBytes(file.size)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatDate(file.lastModified)}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => copyUrl(file.url, file.key)}
                        title="Copy public URL"
                        className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                      >
                        {copiedKey === file.key ? (
                          <Check className="h-3.5 w-3.5 text-green-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </AppShell>
  );
}
