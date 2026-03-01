export function StatsBar() {
  const stats = [
    { label: "Total Jobs", value: 0 },
    { label: "Pending", value: 0 },
    { label: "Submitted", value: 0 },
    { label: "Accepted", value: 0 },
    { label: "Rejected", value: 0 }
  ];

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2>Stats</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 12 }}>
        {stats.map((stat) => (
          <div key={stat.label} className="card">
            <div style={{ fontSize: 24, fontWeight: 700 }}>{stat.value}</div>
            <div style={{ color: "var(--text-secondary)" }}>{stat.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
