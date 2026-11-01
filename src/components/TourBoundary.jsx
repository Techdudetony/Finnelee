import { Component } from "react";

/**
 * Wraps the guided tour, which is downloaded on demand. If that download fails
 * (offline, or the app was updated while open) or the tour fails while drawing, this
 * shows nothing and calls onFail, so the rest of the app keeps working instead of the
 * whole page going blank. React only supports this as a class component.
 */
export default class TourBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    // Kept in the browser console for debugging; never sent anywhere.
    console.error("The guided tour couldn't load:", error);
    this.props.onFail();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
