"use client";

import { useEffect, useState } from "react";
import { Hash, Lock, User, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

/**
 * Slack channel/user picker used by the template editor's notification rows.
 *
 * Stores the Slack ID (C…/G…/U…) in the consuming form state. The display
 * name is looked up at render time from the fetched directory so we never
 * depend on a stale name cached in D1.
 */

interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
}

interface SlackUser {
  id: string;
  name: string;
  displayName: string;
  avatar: string | null;
}

interface DirectoryState {
  channels: SlackChannel[];
  users: SlackUser[];
  loading: boolean;
  error: string | null;
}

// Module-level cache so every notification row doesn't refetch. Cleared on
// a full page reload, which is fine — this is an editor.
let cached: DirectoryState | null = null;
const listeners = new Set<(s: DirectoryState) => void>();

async function loadDirectory(force = false): Promise<void> {
  if (cached && !force && !cached.error) return;
  const next: DirectoryState = {
    channels: cached?.channels ?? [],
    users: cached?.users ?? [],
    loading: true,
    error: null,
  };
  cached = next;
  listeners.forEach((fn) => fn(next));

  try {
    const [chRes, usRes] = await Promise.all([
      fetch("/api/slack/channels"),
      fetch("/api/slack/users"),
    ]);
    const chData = (await chRes.json()) as {
      channels?: SlackChannel[];
      error?: string;
    };
    const usData = (await usRes.json()) as {
      users?: SlackUser[];
      error?: string;
    };
    const error =
      (!chRes.ok && chData.error) || (!usRes.ok && usData.error) || null;
    cached = {
      channels: chData.channels ?? [],
      users: usData.users ?? [],
      loading: false,
      error: error || null,
    };
  } catch (e) {
    cached = {
      channels: [],
      users: [],
      loading: false,
      error: (e as Error).message,
    };
  }
  listeners.forEach((fn) => fn(cached!));
}

function useSlackDirectory() {
  const [state, setState] = useState<DirectoryState>(
    () => cached ?? { channels: [], users: [], loading: false, error: null },
  );
  useEffect(() => {
    listeners.add(setState);
    if (!cached) loadDirectory();
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state;
}

interface SlackTargetPickerProps {
  value: string;
  onChange: (id: string) => void;
  className?: string;
}

export function SlackTargetPicker({
  value,
  onChange,
  className,
}: SlackTargetPickerProps) {
  const [open, setOpen] = useState(false);
  const directory = useSlackDirectory();

  const selectedChannel = directory.channels.find((c) => c.id === value);
  const selectedUser = directory.users.find((u) => u.id === value);

  const label = selectedChannel
    ? `#${selectedChannel.name}`
    : selectedUser
      ? selectedUser.displayName
      : value && !directory.loading
        ? `Unknown (${value.slice(0, 8)}…)`
        : value
          ? value
          : "Select channel or user";

  const LeadingIcon = selectedChannel
    ? selectedChannel.isPrivate
      ? Lock
      : Hash
    : selectedUser
      ? User
      : value
        ? AlertTriangle
        : Hash;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn(
          "h-8 justify-start gap-1.5 font-normal text-xs",
          !value && "text-muted-foreground",
          className,
        )}
        onClick={() => setOpen(true)}
      >
        {selectedUser?.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={selectedUser.avatar}
            alt=""
            className="h-4 w-4 rounded-sm shrink-0"
          />
        ) : (
          <LeadingIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <span className="truncate">{label}</span>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Pick a Slack channel or user"
        description="Fires the notification to the selected target."
      >
        <CommandInput placeholder="Search channels and people…" />
        <CommandList>
          {directory.loading && (
            <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading Slack directory…
            </div>
          )}
          {directory.error && (
            <div className="px-3 py-3 text-xs text-destructive space-y-1">
              <div className="font-medium">Couldn&apos;t load Slack directory</div>
              <div className="text-muted-foreground">{directory.error}</div>
            </div>
          )}
          <CommandEmpty>No matches.</CommandEmpty>

          {directory.channels.length > 0 && (
            <CommandGroup heading="Channels">
              {directory.channels.map((c) => (
                <CommandItem
                  key={c.id}
                  // Include the ID so users pasting one can still find it.
                  value={`${c.name} ${c.id}`}
                  onSelect={() => {
                    onChange(c.id);
                    setOpen(false);
                  }}
                >
                  {c.isPrivate ? (
                    <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <span>{c.name}</span>
                  {!c.isMember && (
                    <span className="ml-auto text-xxs text-amber-600 dark:text-amber-400">
                      bot not in channel
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {directory.users.length > 0 && (
            <CommandGroup heading="People (DM)">
              {directory.users.map((u) => (
                <CommandItem
                  key={u.id}
                  value={`${u.displayName} ${u.name} ${u.id}`}
                  onSelect={() => {
                    onChange(u.id);
                    setOpen(false);
                  }}
                >
                  {u.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={u.avatar}
                      alt=""
                      className="h-4 w-4 rounded-sm"
                    />
                  ) : (
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <span>{u.displayName}</span>
                  <span className="ml-auto text-xxs text-muted-foreground">
                    @{u.name}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
