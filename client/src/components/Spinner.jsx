export default function Spinner({ label }) {
  return (
    <div className="loading-state">
      <span className="spinner" />
      {label && <p className="placeholder-text">{label}</p>}
    </div>
  );
}
