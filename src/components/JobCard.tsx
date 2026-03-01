interface JobCardProps {
  company: string;
  role: string;
  location: string;
}

export function JobCard({ company, role, location }: JobCardProps) {
  return (
    <article className="card">
      <h3>{role}</h3>
      <p>{company}</p>
      <p style={{ color: "var(--text-secondary)" }}>{location}</p>
      <button
        style={{
          marginTop: 12,
          padding: "8px 12px",
          borderRadius: 8,
          border: "none",
          background: "var(--accent-blue)",
          color: "white"
        }}
      >
        Auto-Fill Application
      </button>
    </article>
  );
}
