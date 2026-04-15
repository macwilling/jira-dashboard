"use client";

import { useEffect, useState } from "react";
import { Hash, Lock, User, AlertTriangle, Loader2 } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { Button } from "@/components/ui/button";
import {
  Command,
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
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              "h-8 justify-start gap-1.5 font-normal text-xs",
              !value && "text-muted-foreground",
              className,
            )}
          />
        }
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
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner sideOffset={4} align="start" className="z-50">
          <Popover.Popup
            className="w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
            style={{ minWidth: "var(--anchor-width)" }}
          >
            <Command className="[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xxs [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-1 [&_[cmdk-input]]:h-9 [&_[cmdk-item]]:rounded-md [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2">
              <CommandInput placeholder="Search channels and people…" />
              <CommandList className="max-h-72 py-1">
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
                        value={`${c.name} ${c.id}`}
                        onSelect={() => {
                          onChange(c.id);
                          setOpen(false);
                        }}
                      >
                        {c.isPrivate ? (
                          <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        ) : (
                          <Hash className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                        <span className="flex-1 min-w-0 truncate">{c.name}</span>
                        {!c.isMember && (
                          <span className="shrink-0 whitespace-nowrap text-xxs text-amber-600 dark:text-amber-400">
                            bot not joined
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
                            className="h-4 w-4 rounded-sm shrink-0"
                          />
                        ) : (
                          <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                        <span className="flex-1 min-w-0 truncate">{u.displayName}</span>
                        <span className="shrink-0 whitespace-nowrap text-xxs text-muted-foreground">
                          @{u.name}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
