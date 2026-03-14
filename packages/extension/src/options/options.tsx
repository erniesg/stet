import { render } from 'preact';

function Options() {
  return (
    <div style={{ maxWidth: '600px', margin: '24px auto', fontFamily: 'system-ui' }}>
      <h1>Hammurabi Settings</h1>
      <p>Phase 5 options page coming soon.</p>
    </div>
  );
}

render(<Options />, document.getElementById('app')!);
