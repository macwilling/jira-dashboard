import { walkMarkdownTree } from "@/lib/google/drive";
import { kvGet, kvPut } from "@/lib/readai/kv";

/**
 * Obsidian vault locations in Google Drive. The vault syncs between
 * ~/Documents/obsidian-vault locally and the "obsidian-vault" Drive folder;
 * these ids are pinned so nothing ever has to search for them. Overridable
 * via env for vault moves.
 */

export function vaultRootFolderId(): string {
  return (
    process.env.DRIVE_VAULT_ROOT_FOLDER_ID ??
    "1StAb4CMZihwSNbdaLtXV0MkFTGncBOJr"
  );
}

export function meetingNotesFolderId(): string {
  return (
    process.env.DRIVE_MEETING_NOTES_FOLDER_ID ??
    "1lsfOp2UPuQT4rdSDNBhqR5CqTlF7X9Qb"
  );
}

export function transcriptsFolderId(): string {
  return (
    process.env.DRIVE_TRANSCRIPTS_FOLDER_ID ??
    "1JZp-vPu2mNbGCttaPra9-MC1_v6-_OLB"
  );
}

const INDEX_CACHE_KEY = "readai-vault-index";
const INDEX_CACHE_TTL_SECONDS = 60 * 60;

/**
 * Vault-relative paths ("Folder/Note", no .md) of every note in the vault,
 * cached in KV for an hour. Used for the previous-in-series link and as the
 * link menu handed to the enrichment routine. Transcripts are excluded —
 * they'd be noise as link targets.
 */
export async function getVaultIndex(): Promise<string[]> {
  const cached = await kvGet(INDEX_CACHE_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as string[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // fall through to rebuild
    }
  }

  const paths = await walkMarkdownTree(vaultRootFolderId(), [
    transcriptsFolderId(),
  ]);
  await kvPut(INDEX_CACHE_KEY, JSON.stringify(paths), INDEX_CACHE_TTL_SECONDS);
  return paths;
}
