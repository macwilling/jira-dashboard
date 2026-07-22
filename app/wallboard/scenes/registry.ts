import type { Scene } from "./types";
import SprintBoardScene from "./SprintBoardScene";
import FlowHealthScene, { useFlowAlert } from "./FlowHealthScene";

/**
 * The kiosk rotation, in order. Adding a scene is: build a module that renders
 * the view (reading shared context / its own SWR), optionally export a
 * `useAlert` probe, and register it here. The shell handles rotation, deep
 * links, pinning, and cut-ins for everything in this list.
 *
 * Roadmap scenes (Support Pulse, Release Radar, DORA, Reliability, Team & Day,
 * the AI Daily Narrative) each land as one more entry — see the vision board.
 */
export const SCENES: Scene[] = [
  {
    id: "sprint",
    title: "Sprint Board",
    source: "Jira · sprint",
    accent: "#4493f8",
    Component: SprintBoardScene,
    dwellMs: 45_000,
    enabled: true,
  },
  {
    id: "flow",
    title: "Flow Health",
    source: "Jira · flow",
    accent: "#d29922",
    Component: FlowHealthScene,
    useAlert: useFlowAlert,
    dwellMs: 35_000,
    enabled: true,
  },
];
