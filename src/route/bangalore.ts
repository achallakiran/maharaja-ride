import { ROUTE_A, ROUTE_B, MILESTONES } from './route-data.ts';
import { RoadLoop, buildLaneRing } from './loop.ts';

let cached: RoadLoop | null = null;

/** The real Utopia -> Aquamarine (route A) and back (route B) loop, built once. */
export function bangaloreLoop(): RoadLoop {
  if (!cached) {
    cached = new RoadLoop(buildLaneRing(ROUTE_A, ROUTE_B));
    cached.placeMilestones(MILESTONES);
  }
  return cached;
}
