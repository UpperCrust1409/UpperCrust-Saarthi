export default function KPICard({ label, value, sub, subClass, variant = '', onClick }) {
  return (
    <div
      className={`kc ${variant}`}
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : {}}
    >
      <div className="kc-lbl">{label}</div>
      <div className="kc-val">{value}</div>
      {sub && <div className={`kc-sub ${subClass || 'neu'}`}>{sub}</div>}
    </div>
  );
}
