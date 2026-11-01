import { Component, type ErrorInfo, type ReactNode } from "react";

import { AlertIcon } from "./icons";

/**
 * A render error stopped where it happened. Without one React unmounts the whole page and leaves
 * it blank, title bar and all; with one, only the part that broke gives way, to `fallback`, and
 * the rest keeps running. `retry` mounts the children again (after `fallback` has put right what
 * broke them, or they fail the same way).
 */
export class Crash extends Component<
  Readonly<{ fallback: (error: Error, retry: () => void) => ReactNode; children: ReactNode }>,
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    return error ? this.props.fallback(error, () => this.setState({ error: null })) : this.props.children;
  }
}

/** What a crash shows: what gave way, the error's own words (so it can be read off a screen), and the way out. */
export function CrashNote({ title, error, children }: Readonly<{ title: string; error: Error; children: ReactNode }>) {
  return (
    <div className="mh-empty" role="alert">
      <span className="mh-empty-icon mh-error">
        <AlertIcon size={26} />
      </span>
      <div className="mh-empty-title">{title}</div>
      <code className="mh-crash-message">{error.message || String(error)}</code>
      <div className="mh-quick">{children}</div>
    </div>
  );
}
