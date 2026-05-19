import { Module } from "@nestjs/common";

import { JobsModule } from "../jobs/jobs.module.js";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";

@Module({
  // JobsModule export is required so HealthService can inject BullMQJobQueue
  // and surface `checks.jobs` on /health/ready (CRIT-1 worker registration).
  imports: [JobsModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
