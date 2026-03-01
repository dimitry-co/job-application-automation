import { StatsBar } from "@/components/StatsBar";
import { JobQueue } from "@/components/JobQueue";
import { ApplicationTracker } from "@/components/ApplicationTracker";
import { ActivityFeed } from "@/components/ActivityFeed";

export default function HomePage() {
  return (
    <main>
      <h1>CareerFlow Dashboard</h1>
      <StatsBar />
      <JobQueue />
      <ApplicationTracker />
      <ActivityFeed />
    </main>
  );
}
