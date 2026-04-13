"use client";

import { Zap } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { MERGE_FIELDS, type MergeFieldDef } from "@/lib/releases/merge-fields";
import { cn } from "@/lib/utils";

interface Props {
  onInsert: (token: string) => void;
  className?: string;
}

export function MergeFieldPicker({ onInsert, className }: Props) {
  const groups = MERGE_FIELDS.reduce<Record<string, MergeFieldDef[]>>((acc, f) => {
    (acc[f.group] ||= []).push(f);
    return acc;
  }, {});
  const groupOrder: MergeFieldDef["group"][] = ["Release", "Task"];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "shrink-0 h-7 w-7 rounded-md border bg-background text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center transition-colors",
          className,
        )}
        title="Insert merge field"
        aria-label="Insert merge field"
      >
        <Zap className="h-3 w-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[280px]">
        {groupOrder.map((group, i) => (
          <div key={group}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{group}</DropdownMenuLabel>
            {groups[group]?.map((f) => (
              <DropdownMenuItem
                key={f.token}
                onClick={() => onInsert(f.token)}
                className="gap-3"
              >
                <span className="flex-1">{f.label}</span>
                <code className="text-xxs font-mono text-muted-foreground">
                  {f.token}
                </code>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Given a text input or textarea element, insert `token` at the current caret
 * position (or at the end if not focused) and return the new value. The caller
 * is expected to update state with the returned value and call `restoreCaret`
 * after render to move the caret past the inserted token.
 */
export function insertTokenAt(
  el: HTMLInputElement | HTMLTextAreaElement | null,
  currentValue: string,
  token: string,
): { nextValue: string; restoreCaret: () => void } {
  if (!el) {
    return {
      nextValue: currentValue + token,
      restoreCaret: () => {},
    };
  }
  const start = el.selectionStart ?? currentValue.length;
  const end = el.selectionEnd ?? currentValue.length;
  const nextValue = currentValue.slice(0, start) + token + currentValue.slice(end);
  const restoreCaret = () => {
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  };
  return { nextValue, restoreCaret };
}
