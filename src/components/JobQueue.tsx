import { JobCard } from "@/components/JobCard";

export function JobQueue() {
  return (
    <section style={{ marginTop: 16 }}>
      <h2>Job Listings</h2>
      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))"
        }}
      >
        <JobCard company="Example Co" role="Software Engineer" location="Remote (US)" />
      </div>
    </section>
  );
}
