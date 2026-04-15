"use client";

import { useState, useEffect, useCallback } from "react";
import { CheckCircle2, XCircle, Loader2, Save, LogOut, Send, TestTube } from "lucide-react";
import { AppShell } from "@/components/app-shell/AppShell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SlackTargetPicker } from "@/components/releases/SlackTargetPicker";

interface ConfigStatus {
  jiraConnected: boolean;
  jiraStatus: { ok: boolean; user?: string; error?: string };
  kvConnected: boolean;
  config: {
    jqlFilter: string;
    l2LabelPatterns: string[];
    sprintFieldId?: string;
    boardId?: string;
    standupTime?: string;
    standupTimezone?: string;
    releaseApprovalSlackTarget?: string;
  } | null;
}

interface SlackAuthStatus {
  ok: boolean;
  configured: boolean;
  team?: string;
  user?: string;
  url?: string;
  error?: string;
}

interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
}

export default function SettingsPage() {
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ count: number } | null>(null);
  const [saved, setSaved] = useState(false);

  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [googleDisconnecting, setGoogleDisconnecting] = useState(false);

  const [jqlFilter, setJqlFilter] = useState("");
  const [l2Labels, setL2Labels] = useState("");
  const [sprintFieldId, setSprintFieldId] = useState("");
  const [boardId, setBoardId] = useState("");
  const [standupTime, setStandupTime] = useState("09:00");
  const [standupTimezone, setStandupTimezone] = useState("");
  const [releaseApprovalTarget, setReleaseApprovalTarget] = useState("");
  const [approvalTestSending, setApprovalTestSending] = useState(false);
  const [approvalTestResult, setApprovalTestResult] = useState<
    | { kind: "sent"; warnings: string[] }
    | { kind: "error"; error: string }
    | null
  >(null);

  const [slackAuth, setSlackAuth] = useState<SlackAuthStatus | null>(null);
  const [slackTesting, setSlackTesting] = useState(false);
  const [jiraRechecking, setJiraRechecking] = useState(false);

  const loadGoogleStatus = useCallback(() => {
    fetch("/api/google/status")
      .then((r) => r.json())
      .then((d: GoogleStatus) => setGoogleStatus(d))
      .catch(() => {});
  }, []);

  // Check for OAuth redirect result in URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("google_connected")) {
      loadGoogleStatus();
      // Clean the URL
      window.history.replaceState({}, "", "/settings");
    } else if (params.get("google_error")) {
      loadGoogleStatus();
      window.history.replaceState({}, "", "/settings");
    }
  }, [loadGoogleStatus]);

  // Load current config
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data: ConfigStatus) => {
        setStatus(data);
        if (data.config) {
          setJqlFilter(data.config.jqlFilter);
          setL2Labels(data.config.l2LabelPatterns.join(", "));
          setSprintFieldId(data.config.sprintFieldId || "");
          setBoardId(data.config.boardId || "");
          setStandupTime(data.config.standupTime || "09:00");
          setStandupTimezone(data.config.standupTimezone || "");
          setReleaseApprovalTarget(data.config.releaseApprovalSlackTarget || "");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    loadGoogleStatus();
  }, [loadGoogleStatus]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jqlFilter,
          l2LabelPatterns: l2Labels
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          ...(sprintFieldId.trim() ? { sprintFieldId: sprintFieldId.trim() } : {}),
          ...(boardId.trim() ? { boardId: boardId.trim() } : {}),
          ...(standupTime ? { standupTime } : {}),
          ...(standupTimezone.trim() ? { standupTimezone: standupTimezone.trim() } : {}),
          ...(releaseApprovalTarget.trim()
            ? { releaseApprovalSlackTarget: releaseApprovalTarget.trim() }
            : { releaseApprovalSlackTarget: "" }),
        }),
      });
      if (res.ok) setSaved(true);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const handleApprovalTest = async () => {
    const target = releaseApprovalTarget.trim();
    if (!target) return;
    setApprovalTestSending(true);
    setApprovalTestResult(null);
    try {
      const res = await fetch("/api/releases/approval-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const data = await res.json();
      if (res.ok) {
        setApprovalTestResult({
          kind: "sent",
          warnings: Array.isArray(data.warnings) ? data.warnings : [],
        });
      } else {
        setApprovalTestResult({
          kind: "error",
          error: data.error || `HTTP ${res.status}`,
        });
      }
    } catch (e) {
      setApprovalTestResult({ kind: "error", error: (e as Error).message });
    } finally {
      setApprovalTestSending(false);
    }
  };

  const handleJiraRecheck = useCallback(async () => {
    setJiraRechecking(true);
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        const data = (await res.json()) as ConfigStatus;
        setStatus(data);
      }
    } catch {
      // ignore
    } finally {
      setJiraRechecking(false);
    }
  }, []);

  const handleSlackTest = useCallback(async () => {
    setSlackTesting(true);
    try {
      const res = await fetch("/api/slack/auth-test");
      const data = (await res.json()) as SlackAuthStatus;
      setSlackAuth(data);
    } catch (e) {
      setSlackAuth({
        ok: false,
        configured: true,
        error: (e as Error).message,
      });
    } finally {
      setSlackTesting(false);
    }
  }, []);

  // Auto-check Slack connection once on mount so the status line isn't blank.
  useEffect(() => {
    handleSlackTest();
  }, [handleSlackTest]);

  const handleGoogleDisconnect = async () => {
    setGoogleDisconnecting(true);
    await fetch("/api/auth/google", { method: "DELETE" });
    setGoogleDisconnecting(false);
    loadGoogleStatus();
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/jira/tickets");
      if (res.ok) {
        const data = await res.json();
        setTestResult({ count: data.tickets?.length || 0 });
      }
    } catch {
      // ignore
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="Settings">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Settings">
      <main className="max-w-2xl mx-auto px-6 py-8 space-y-10">
        {/* INTEGRATIONS */}
        <section className="space-y-3">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Integrations
            </h2>
            <p className="text-xxs text-muted-foreground mt-1">
              Connection status for each external service the app talks to.
            </p>
          </div>

          <div className="space-y-3">
            {/* Jira */}
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">Jira</h3>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  onClick={handleJiraRecheck}
                  disabled={jiraRechecking}
                >
                  {jiraRechecking ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Send className="h-3 w-3" />
                  )}
                  Recheck
                </Button>
              </div>
              <div className="flex items-start gap-2 text-sm">
                {status?.jiraStatus.ok ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                    <span>
                      Connected as{" "}
                      <span className="font-medium">{status.jiraStatus.user}</span>
                    </span>
                  </>
                ) : status?.jiraConnected ? (
                  <>
                    <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                    <span>Authentication failed: {status.jiraStatus.error}</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">
                      Not configured — set{" "}
                      <code className="text-xs bg-muted px-1 py-0.5 rounded">JIRA_URL</code>,{" "}
                      <code className="text-xs bg-muted px-1 py-0.5 rounded">JIRA_EMAIL</code>,{" "}
                      <code className="text-xs bg-muted px-1 py-0.5 rounded">JIRA_API_TOKEN</code>{" "}
                      in environment variables.
                    </span>
                  </>
                )}
              </div>
              {!status?.kvConnected && (
                <div className="flex items-start gap-2 text-sm text-muted-foreground pt-2 border-t">
                  <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    Config storage (Cloudflare KV) not configured — set{" "}
                    <code className="text-xs bg-muted px-1 py-0.5 rounded">CLOUDFLARE_API_TOKEN</code>,{" "}
                    <code className="text-xs bg-muted px-1 py-0.5 rounded">CLOUDFLARE_ACCOUNT_ID</code>,{" "}
                    <code className="text-xs bg-muted px-1 py-0.5 rounded">CLOUDFLARE_KV_NAMESPACE_ID</code>.
                  </span>
                </div>
              )}
            </div>

            {/* Slack */}
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">Slack</h3>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  onClick={handleSlackTest}
                  disabled={slackTesting}
                >
                  {slackTesting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Send className="h-3 w-3" />
                  )}
                  Test connection
                </Button>
              </div>

              <div className="flex items-start gap-2 text-sm">
                {slackAuth === null || slackTesting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">Checking Slack connection…</span>
                  </>
                ) : slackAuth.ok ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                    <span>
                      Connected to <span className="font-medium">{slackAuth.team}</span> as{" "}
                      <span className="font-medium">{slackAuth.user}</span>
                    </span>
                  </>
                ) : !slackAuth.configured ? (
                  <>
                    <XCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                    <span>
                      <span className="font-medium">SLACK_BOT_TOKEN</span> is not set on the server.
                    </span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                    <span>Slack auth failed: {slackAuth.error}</span>
                  </>
                )}
              </div>

              <p className="text-xxs text-muted-foreground leading-relaxed">
                The bot token lives server-side only (env var{" "}
                <code className="bg-muted px-1 rounded">SLACK_BOT_TOKEN</code>) — it is never sent to
                the browser. Required scopes:{" "}
                <code className="bg-muted px-1 rounded">chat:write</code>,{" "}
                <code className="bg-muted px-1 rounded">channels:read</code>,{" "}
                <code className="bg-muted px-1 rounded">users:read</code>. Rotate by regenerating in
                the Slack app&apos;s OAuth &amp; Permissions page and updating the env var.
              </p>
            </div>

            {/* Google */}
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">Google</h3>
                {googleStatus?.configured && googleStatus.connected && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground gap-1.5"
                    onClick={handleGoogleDisconnect}
                    disabled={googleDisconnecting}
                  >
                    {googleDisconnecting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <LogOut className="h-3.5 w-3.5" />
                    )}
                    Disconnect
                  </Button>
                )}
                {googleStatus?.configured && !googleStatus.connected && (
                  <a href="/api/auth/google">
                    <Button size="sm" className="h-7 text-xs">
                      Connect Google
                    </Button>
                  </a>
                )}
              </div>

              {!googleStatus?.configured ? (
                <>
                  <div className="flex items-start gap-2 text-sm text-muted-foreground">
                    <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>
                      Not configured — set{" "}
                      <code className="text-xs bg-muted px-1 py-0.5 rounded">GOOGLE_CLIENT_ID</code>{" "}
                      and{" "}
                      <code className="text-xs bg-muted px-1 py-0.5 rounded">GOOGLE_CLIENT_SECRET</code>{" "}
                      in environment variables.
                    </span>
                  </div>
                  <p className="text-xxs text-muted-foreground pl-6">
                    Create OAuth 2.0 credentials in{" "}
                    <span className="font-medium">Google Cloud Console</span> with the Tasks API and
                    Calendar API enabled. Set the authorized redirect URI to{" "}
                    <code className="bg-muted px-1 rounded">
                      https://your-domain/api/auth/google/callback
                    </code>
                    .
                  </p>
                </>
              ) : googleStatus.connected ? (
                <div className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                  <span>
                    Connected as <span className="font-medium">{googleStatus.email}</span>
                  </span>
                </div>
              ) : (
                <div className="flex items-start gap-2 text-sm text-muted-foreground">
                  <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>Not connected</span>
                </div>
              )}

              {googleStatus?.configured && (
                <p className="text-xxs text-muted-foreground">
                  Used for release checklist tasks with action type{" "}
                  <span className="font-medium">Google Task</span> or{" "}
                  <span className="font-medium">Calendar Event</span>. Grants access to Tasks and
                  Calendar only.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* PREFERENCES */}
        <section className="space-y-3">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Preferences
            </h2>
            <p className="text-xxs text-muted-foreground mt-1">
              App-wide settings that affect multiple features.
            </p>
          </div>

          <div className="rounded-lg border p-4">
            <div className="space-y-1.5 max-w-xs">
              <Label htmlFor="standupTz" className="text-xs">Timezone</Label>
              <Input
                id="standupTz"
                value={standupTimezone}
                onChange={(e) => setStandupTimezone(e.target.value)}
                placeholder={Intl.DateTimeFormat().resolvedOptions().timeZone}
                className="text-xs font-mono"
              />
              <p className="text-xxs text-muted-foreground">
                IANA timezone (e.g. <code className="bg-muted px-1 rounded">America/New_York</code>).
                Used for the standup cutoff and release task scheduling. Defaults to your browser
                timezone.
              </p>
            </div>
          </div>
        </section>

        {/* STANDUP */}
        <section className="space-y-3">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Standup
            </h2>
            <p className="text-xxs text-muted-foreground mt-1">
              What the standup dashboard fetches and how it highlights recent activity.
            </p>
          </div>

          <div className="rounded-lg border p-4 space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="jql" className="text-xs">JQL Filter</Label>
              <Textarea
                id="jql"
                value={jqlFilter}
                onChange={(e) => setJqlFilter(e.target.value)}
                placeholder="project = PROJ AND sprint in openSprints() ORDER BY priority DESC"
                className="min-h-[80px] font-mono text-xs"
              />
              <p className="text-xxs text-muted-foreground">
                JQL query that returns all tickets for your standup board (sprint + L2).
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="l2" className="text-xs">L2 Label Patterns</Label>
              <Input
                id="l2"
                value={l2Labels}
                onChange={(e) => setL2Labels(e.target.value)}
                placeholder="l2-support, l2, support-escalation"
                className="text-xs"
              />
              <p className="text-xxs text-muted-foreground">
                Comma-separated labels. Tickets with any of these labels are shown as L2/Support.
              </p>
            </div>

            <div className="pt-4 border-t space-y-4">
              <div>
                <h3 className="text-xs font-medium">Sprint detection</h3>
                <p className="text-xxs text-muted-foreground mt-0.5">
                  Advanced — override only if sprint info isn&apos;t resolving correctly.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sprintField" className="text-xs">Sprint Custom Field ID</Label>
                <Input
                  id="sprintField"
                  value={sprintFieldId}
                  onChange={(e) => setSprintFieldId(e.target.value)}
                  placeholder="customfield_10020"
                  className="text-xs font-mono"
                />
                <p className="text-xxs text-muted-foreground">
                  The Jira custom field that holds sprint data. Defaults to{" "}
                  <code className="bg-muted px-1 rounded">customfield_10020</code>. Check your Jira
                  field configuration if the sprint name does not appear.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="boardId" className="text-xs">Board ID (optional fallback)</Label>
                <Input
                  id="boardId"
                  value={boardId}
                  onChange={(e) => setBoardId(e.target.value)}
                  placeholder="42"
                  className="text-xs font-mono"
                />
                <p className="text-xxs text-muted-foreground">
                  If sprint info isn&apos;t in issue fields, the dashboard will use the Jira Agile
                  board API to find the active sprint. Find the board ID in your board&apos;s URL:{" "}
                  <code className="bg-muted px-1 rounded">/board/42</code>.
                </p>
              </div>
            </div>

            <div className="pt-4 border-t space-y-4">
              <div>
                <h3 className="text-xs font-medium">Daily cutoff</h3>
                <p className="text-xxs text-muted-foreground mt-0.5">
                  Controls the &quot;Updated since last standup&quot; threshold on the dashboard.
                  Interpreted in the app timezone set in Preferences.
                </p>
              </div>

              <div className="space-y-1.5 max-w-xs">
                <Label htmlFor="standupTime" className="text-xs">Standup Time</Label>
                <Input
                  id="standupTime"
                  type="time"
                  value={standupTime}
                  onChange={(e) => setStandupTime(e.target.value)}
                  className="text-xs font-mono"
                />
              </div>
            </div>
          </div>
        </section>

        {/* RELEASE APPROVAL */}
        <section className="space-y-3">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Release Approval
            </h2>
            <p className="text-xxs text-muted-foreground mt-1">
              Gate release task dispatch behind a Slack approval message.
            </p>
          </div>

          <div className="rounded-lg border p-4 space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              When set, the Jira version webhook materializes task instances but holds Google
              dispatch until you click <span className="font-medium">Approve</span> on an
              interactive Slack message. Leave empty to auto-dispatch (current behavior).
            </p>

            <div className="space-y-1.5">
              <Label className="text-xs">Approval channel or DM</Label>
              <div className="flex items-center gap-2 flex-wrap">
                <SlackTargetPicker
                  value={releaseApprovalTarget}
                  onChange={setReleaseApprovalTarget}
                />
                {releaseApprovalTarget && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xxs text-muted-foreground"
                    onClick={() => setReleaseApprovalTarget("")}
                  >
                    Clear
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5 ml-auto"
                  onClick={handleApprovalTest}
                  disabled={!releaseApprovalTarget.trim() || approvalTestSending}
                  title="Post a throwaway approval message; clicking Approve in Slack confirms the round-trip works"
                >
                  {approvalTestSending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <TestTube className="h-3 w-3" />
                  )}
                  Send test message
                </Button>
              </div>
              <p className="text-xxs text-muted-foreground">
                Pick a channel (#releases) or DM yourself. The bot must be a member of the channel
                to post.
              </p>

              {approvalTestResult?.kind === "sent" && (
                <div className="rounded-md border border-blue-500/30 bg-blue-500/5 px-3 py-2 text-xs space-y-1.5">
                  <p className="text-foreground">
                    <CheckCircle2 className="inline h-3 w-3 text-blue-600 dark:text-blue-400 mr-1 align-text-bottom" />
                    Test message sent. Open Slack — clicking{" "}
                    <span className="font-medium">Approve (test)</span> should edit the message to{" "}
                    <span className="font-medium">&quot;Test successful&quot;</span>.
                  </p>
                  <p className="text-xxs text-muted-foreground">
                    If the buttons do nothing, the app&apos;s interactive endpoint isn&apos;t
                    reachable from Slack — check{" "}
                    <code className="bg-muted px-1 rounded">SLACK_SIGNING_SECRET</code>, the Slack
                    app&apos;s Request URL, and the bot&apos;s membership in the channel.
                  </p>
                  {approvalTestResult.warnings.length > 0 && (
                    <ul className="text-xxs text-amber-700 dark:text-amber-400 list-disc list-inside space-y-0.5">
                      {approvalTestResult.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {approvalTestResult?.kind === "error" && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  <XCircle className="inline h-3 w-3 mr-1 align-text-bottom" />
                  {approvalTestResult.error}
                </div>
              )}
            </div>

            <div className="rounded-md border-dashed border bg-muted/30 p-3 space-y-1">
              <p className="text-xxs font-medium text-foreground">Required server setup</p>
              <p className="text-xxs text-muted-foreground leading-relaxed">
                Set <code className="bg-muted px-1 rounded">SLACK_SIGNING_SECRET</code> (Slack app →
                Basic Information → App Credentials) and{" "}
                <code className="bg-muted px-1 rounded">NEXT_PUBLIC_APP_URL</code> (your production
                URL, e.g. <code className="bg-muted px-1 rounded">https://app.example.com</code>),
                then in your Slack app enable{" "}
                <span className="font-medium">Interactivity</span> with Request URL{" "}
                <code className="bg-muted px-1 rounded">
                  {"{NEXT_PUBLIC_APP_URL}"}/api/webhooks/slack/interactive
                </code>
                .
              </p>
            </div>
          </div>
        </section>

        {/* ACTIONS */}
        <div className="flex items-center gap-3 pt-4 border-t">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !jqlFilter.trim()}
            className="h-8 text-xs"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <Save className="h-3.5 w-3.5 mr-1.5" />
            )}
            Save Configuration
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={testing || !status?.jiraStatus.ok}
            className="h-8 text-xs"
          >
            {testing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : null}
            Test Jira Query
          </Button>

          {saved && (
            <span className="text-xs text-green-600 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Saved
            </span>
          )}

          {testResult && (
            <span className="text-xs text-muted-foreground">
              Found {testResult.count} ticket{testResult.count !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </main>
    </AppShell>
  );
}
