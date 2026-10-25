import { Component, type ReactNode, type ErrorInfo } from "react";
import { BugRadar } from "./index.js";
export class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, _info: ErrorInfo) {
    BugRadar.captureException(error);
  }
  render() {
    return this.state.failed
      ? (this.props.fallback ?? (
          <section role="alert">
            <h2>Something went wrong</h2>
            <p>Try reloading this part of the application.</p>
            <button onClick={() => this.setState({ failed: false })}>
              Try again
            </button>
          </section>
        ))
      : this.props.children;
  }
}
