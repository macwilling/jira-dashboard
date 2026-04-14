"use client";

import { useMemo } from "react";
import { Zap } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  MERGE_FIELDS,
  EVENT_MERGE_FIELDS,
  buildSampleMergeContext,
  renderMergeFields,
  type MergeFieldDef,
} from "@/lib/releases/merge-fields";
import type { ReleaseEventType } from "@/lib/releases/types";
import { cn } from "@/lib/utils";

interface Props {
  onInsert: (token: string) => void;
  className?: string;
  /**
   * When set, also show the Event group — filtered to tokens available for
   * this event type. Omit to show the task-flow picker (Release + Task only).
   */
  eventType?: ReleaseEventType;
}

export function MergeFieldPicker({ onInsert, className, eventType }: Props) {
  const eventFields = eventType
    ? EVENT_MERGE_FIELDS.filter(
        (f) => !f.events || f.events.includes(eventType),
      )
    : [];
  const allFields: MergeFieldDef[] = [
    ...MERGE_FIELDS.filter((f) => f.group !== "Task" || !eventType),
    ...eventFields,
  ];

  const groups = allFields.reduce<Record<string, MergeFieldDef[]>>((acc, f) => {
    (acc[f.group] ||= []).push(f);
    return acc;
  }, {});
  const groupOrder: MergeFieldDef["group"][] = eventType
    ? ["Release", "Event"]
    : ["Release", "Task"];

  const sampleCtx = useMemo(() => buildSampleMergeContext(), []);
  const sampleValue = (token: string) =>
    (renderMergeFields(token, sampleCtx) ?? "").trim() || "(empty)";

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
      <DropdownMenuContent align="end" className="min-w-[340px]">
        {groupOrder.map((group, i) => (
          <DropdownMenuGroup key={group}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{group}</DropdownMenuLabel>
            {groups[group]?.map((f) => (
              <DropdownMenuItem
                key={f.token}
                onClick={() => onInsert(f.token)}
                className="gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate">{f.label}</span>
                    <code className="text-xxs font-mono text-muted-foreground shrink-0">
                      {f.token}
                    </code>
                  </div>
                  <div className="text-xxs text-foreground/60 font-mono truncate mt-0.5">
                    → {sampleValue(f.token)}
                  </div>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
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
