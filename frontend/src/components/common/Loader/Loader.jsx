import './Loader.css';

export default function Loader({ label = 'Loading…', size = 'md' }) {
  return (
    <div className={`loader loader-${size}`} role="status" aria-live="polite">
      <span className="loader-ring" aria-hidden="true" />
      <span className="loader-label">{label}</span>
    </div>
  );
}
