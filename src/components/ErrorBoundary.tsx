import { Component, type ErrorInfo, type ReactNode } from "react";
import { downloadSnapshot } from "@/services/backup/backup";

/**
 * Without this, a single render error unmounts the tree and leaves a white
 * screen — with the day's work still sitting in IndexedDB, invisible and
 * apparently lost.
 *
 * The important affordance here is the export button: whatever broke, the data
 * is still on disk, and staff can get it out before touching anything else.
 */
interface Props { children: ReactNode }
interface State { error: Error | null; info: string | null; exported: string | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null, exported: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("Doggie Retreat crashed:", error, info);
    this.setState({ info: info.componentStack?.slice(0, 1200) ?? null });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-start justify-center bg-ink-50 p-6">
        <div className="card mt-12 flex w-full max-w-[620px] flex-col gap-3 p-6">
          <img src="/karma-head.png" alt="" aria-hidden="true"
               className="h-12 w-12 rounded-full" style={{ imageRendering: "pixelated" }} />
          <h1 className="text-[20px] font-bold tracking-tight">Something broke on this screen</h1>
          <p className="text-[13.5px] leading-relaxed text-ink-600">
            Your data is safe — it's stored in this browser and nothing has been deleted.
            Export a backup before you do anything else, then reload.
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-primary"
              onClick={async () => {
                try {
                  const name = await downloadSnapshot();
                  this.setState({ exported: name });
                } catch {
                  this.setState({ exported: "failed" });
                }
              }}
            >
              Export a backup now
            </button>
            <button className="btn" onClick={() => window.location.reload()}>
              Reload the app
            </button>
            <a className="btn" href="#/settings" onClick={() => setTimeout(() => window.location.reload(), 50)}>
              Go to Settings
            </a>
          </div>

          {this.state.exported && this.state.exported !== "failed" && (
            <p className="rounded bg-signal-greenSoft px-3 py-2 text-[12.5px] font-semibold text-signal-green">
              Saved {this.state.exported}
            </p>
          )}
          {this.state.exported === "failed" && (
            <p className="rounded bg-signal-redSoft px-3 py-2 text-[12.5px] text-signal-red">
              The export failed too. Don't clear this browser's data — the records are still in it.
            </p>
          )}

          <details className="mt-1">
            <summary className="cursor-pointer text-[12px] font-semibold text-ink-500">
              Technical detail
            </summary>
            <pre className="mt-2 max-h-[240px] overflow-auto rounded bg-ink-100 p-2 font-mono text-[11px] text-ink-700">
              {this.state.error.message}
              {this.state.info ? `\n${this.state.info}` : ""}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
