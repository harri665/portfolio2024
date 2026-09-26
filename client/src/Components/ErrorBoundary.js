import React from 'react';

// React unmounts the whole tree when a render throws, which leaves a blank
// page. Wrap anything that can fail on some devices (WebGL above all) so the
// failure stays local and the rest of the page still shows.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error(`[ErrorBoundary${this.props.name ? `:${this.props.name}` : ''}]`, error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }

    return this.props.children;
  }
}
