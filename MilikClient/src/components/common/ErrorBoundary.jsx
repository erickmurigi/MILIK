import { Component } from "react";

// Vite produces "Failed to fetch dynamically imported module: …" when a
// stale app tries to load a chunk that no longer exists after a deploy.
// React's lazy() never retries a failed import, so "Try again" loops forever.
// Detect the pattern and reload once to pick up fresh chunk hashes.
const CHUNK_ERROR_FLAG = "eb_chunk_reload";

const isChunkError = (err) => {
  if (!err) return false;
  const msg = String(err.message || "");
  return (
    err.name === "ChunkLoadError" ||
    msg.includes("Failed to fetch dynamically imported module") ||
    msg.includes("Importing a module script failed") ||
    msg.includes("Loading chunk") ||
    msg.includes("error loading dynamically imported module")
  );
};

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, isChunkError: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error, isChunkError: isChunkError(error) };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info.componentStack);

    // Auto-reload once on stale-chunk errors so the user doesn't have to
    // manually refresh after a deployment.
    if (isChunkError(error)) {
      try {
        if (!sessionStorage.getItem(CHUNK_ERROR_FLAG)) {
          sessionStorage.setItem(CHUNK_ERROR_FLAG, "1");
          window.location.reload();
        }
      } catch {
        // sessionStorage unavailable in some private-browsing contexts — ignore
      }
    }
  }

  handleReset = () => this.setState({ hasError: false, error: null, isChunkError: false });
  handleReload = () => window.location.reload();

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return typeof this.props.fallback === "function"
          ? this.props.fallback({ error: this.state.error, reset: this.handleReset })
          : this.props.fallback;
      }

      const { isChunkError: isChunk } = this.state;
      return (
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-lg border border-red-200 bg-red-50 p-8 text-center">
          <svg className="h-10 w-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <p className="text-sm font-medium text-red-700">Something went wrong in this section.</p>
          {isChunk && (
            <p className="text-xs text-red-500">
              A new version of the app was deployed. Reloading…
            </p>
          )}
          <div className="flex gap-2">
            {isChunk ? (
              <button
                onClick={this.handleReload}
                className="rounded-md bg-red-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
              >
                Reload Page
              </button>
            ) : (
              <button
                onClick={this.handleReset}
                className="rounded-md bg-red-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
              >
                Try again
              </button>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
