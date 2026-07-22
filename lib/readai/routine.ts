/**
 * Fires the claude.ai routine that enriches an already-written meeting note
 * (key decisions, action-item owners, related-note links — posted back via
 * /api/readai/enrich). Uses the Claude Code routines API (beta):
 *   POST https://api.anthropic.com/v1/claude_code/routines/{id}/fire
 * The `text` body arrives in the routine session wrapped in a
 * <routine-fire-payload> block — the routine's saved prompt must reference
 * that block explicitly, or the session will ignore the payload.
 */

const ROUTINES_API_BASE = "https://api.anthropic.com/v1/claude_code/routines";
const ROUTINES_BETA_HEADER = "experimental-cc-routine-2026-04-01";

export interface RoutineFireResult {
  sessionId?: string;
  sessionUrl?: string;
}

export function hasRoutineConfig(): boolean {
  return !!(process.env.CLAUDE_ROUTINE_ID && process.env.CLAUDE_ROUTINE_TOKEN);
}

export async function fireMeetingNotesRoutine(
  text: string,
): Promise<RoutineFireResult> {
  const routineId = process.env.CLAUDE_ROUTINE_ID;
  const token = process.env.CLAUDE_ROUTINE_TOKEN;
  if (!routineId || !token) {
    throw new Error(
      "Routine not configured — set CLAUDE_ROUTINE_ID and CLAUDE_ROUTINE_TOKEN",
    );
  }

  const res = await fetch(`${ROUTINES_API_BASE}/${routineId}/fire`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": ROUTINES_BETA_HEADER,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`routine fire failed: ${res.status} ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    claude_code_session_id?: string;
    claude_code_session_url?: string;
  };
  return {
    sessionId: data.claude_code_session_id,
    sessionUrl: data.claude_code_session_url,
  };
}
