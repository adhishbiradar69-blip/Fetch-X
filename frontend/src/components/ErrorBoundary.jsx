import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center', fontFamily: 'system-ui' }}>
          <h2 style={{ color: '#dc2626', marginBottom: 12 }}>Something went wrong</h2>
          <pre style={{
            fontSize: 13, textAlign: 'left', padding: 16, borderRadius: 8,
            overflow: 'auto', maxWidth: 700, margin: '0 auto',
            /* theme tokens (not hardcoded light palette) so it reads in dark mode too */
            color: 'var(--ink, #1c1840)',
            background: 'rgba(239,68,68,0.05)',
            border: '1px solid var(--line, #e6e4f0)',
          }}>
            {this.state.error?.message || String(this.state.error)}
          </pre>
          <button onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            style={{ marginTop: 16, padding: '10px 24px', background: '#5b4fe9', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
