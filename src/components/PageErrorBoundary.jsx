import { Component } from "react";
import EmptyState from "./EmptyState";

/**
 * Catches a page that fails while drawing, so the rest of the app (sidebar, search,
 * other pages) keeps working. Nothing is changed or deleted: the saved data stays as it
 * was, and "Try again" simply draws the page again.
 * App.jsx gives it key={page}, so moving to another page always starts fresh.
 * React only supports this as a class component (getDerivedStateFromError).
 */
export default class PageErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    // Kept in the browser console for debugging; never sent anywhere.
    console.error("Page failed to draw:", error, info?.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { label, onHome } = this.props;
    return (
      <EmptyState
        kind="error"
        icon="critical"
        title={`${label} couldn't be shown`}
        className="card"
        action={
          <>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => this.setState({ failed: false })}
            >
              Try again
            </button>
            {onHome && (
              <button type="button" className="btn" onClick={onHome}>
                Go to Dashboard
              </button>
            )}
          </>
        }
      >
        Something on this page didn't load. Your saved data hasn't been changed.
        Try again, or open another page from the menu.
      </EmptyState>
    );
  }
}
