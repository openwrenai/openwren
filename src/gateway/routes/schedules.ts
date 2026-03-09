/**
 * REST API routes for schedule management.
 *
 * These endpoints are used by the CLI (openwren schedule ...) and will be
 * used by the future Web UI. They are thin wrappers around the scheduler's
 * CRUD functions — all business logic lives in src/scheduler/index.ts.
 *
 * Auth: These endpoints require the same WS token as the WebSocket gateway,
 * passed as a Bearer token in the Authorization header. If no gateway.wsToken
 * is configured, the routes are still registered but reject all requests.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { config } from "../../config";
import {
  createJob,
  deleteJob,
  enableJob,
  disableJob,
  listJobs,
  getJob,
  updateJob,
  triggerJob,
  getRunHistory,
} from "../../scheduler";
import { normalizeSchedule } from "../../scheduler/store";
import { timingSafeEqual } from "crypto";

// ---------------------------------------------------------------------------
// Auth middleware — constant-time token comparison
// ---------------------------------------------------------------------------

function authenticate(request: FastifyRequest, reply: FastifyReply): boolean {
  const token = config.gateway.wsToken;
  if (!token) {
    reply.code(503).send({ error: "Gateway token not configured" });
    return false;
  }

  const auth = request.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Missing or invalid Authorization header" });
    return false;
  }

  const provided = auth.slice(7); // strip "Bearer "

  // Constant-time comparison to prevent timing attacks
  const a = Buffer.from(token, "utf-8");
  const b = Buffer.from(provided, "utf-8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    reply.code(401).send({ error: "Invalid token" });
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerScheduleRoutes(app: FastifyInstance): Promise<void> {
  /** GET /api/schedules — list all jobs */
  app.get("/api/schedules", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const jobs = listJobs();
    return {
      jobs: jobs.map(({ jobId, job, nextRun }) => ({
        jobId,
        ...job,
        nextRun,
      })),
    };
  });

  /** GET /api/schedules/:id — get a single job */
  app.get("/api/schedules/:id", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { id } = request.params as { id: string };
    const job = getJob(id);
    if (!job) {
      return reply.code(404).send({ error: `Job "${id}" not found` });
    }
    return { jobId: id, ...job };
  });

  /** POST /api/schedules — create a new job */
  app.post("/api/schedules", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const body = request.body as Record<string, unknown>;

    if (!body.name || !body.schedule || !body.prompt) {
      return reply.code(400).send({ error: "Required fields: name, schedule, prompt" });
    }

    try {
      const jobId = createJob({
        name: body.name as string,
        agent: (body.agent as string) ?? config.defaultAgent,
        schedule: body.schedule as { cron?: string; every?: string; at?: string },
        prompt: body.prompt as string,
        channel: (body.channel as string) ?? "telegram",
        user: (body.user as string) ?? Object.keys(config.users)[0],
        isolated: (body.isolated as boolean) ?? true,
        deleteAfterRun: (body.deleteAfterRun as boolean) ?? false,
        createdBy: (body.createdBy as string) ?? "api",
      });

      return reply.code(201).send({ jobId, message: "Job created" });
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  /** PATCH /api/schedules/:id — update job fields */
  app.patch("/api/schedules/:id", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;

    // Normalize schedule if being updated
    if (body.schedule) {
      body.schedule = normalizeSchedule(body.schedule as any);
    }

    const success = updateJob(id, body as any);
    if (!success) {
      return reply.code(404).send({ error: `Job "${id}" not found` });
    }
    return { message: "Job updated" };
  });

  /** DELETE /api/schedules/:id — delete job + run history */
  app.delete("/api/schedules/:id", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { id } = request.params as { id: string };
    const success = await deleteJob(id);
    if (!success) {
      return reply.code(404).send({ error: `Job "${id}" not found` });
    }
    return { message: "Job deleted" };
  });

  /** POST /api/schedules/:id/enable — enable a job */
  app.post("/api/schedules/:id/enable", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { id } = request.params as { id: string };
    const success = enableJob(id);
    if (!success) {
      return reply.code(404).send({ error: `Job "${id}" not found` });
    }
    return { message: "Job enabled" };
  });

  /** POST /api/schedules/:id/disable — disable a job */
  app.post("/api/schedules/:id/disable", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { id } = request.params as { id: string };
    const success = disableJob(id);
    if (!success) {
      return reply.code(404).send({ error: `Job "${id}" not found` });
    }
    return { message: "Job disabled" };
  });

  /** POST /api/schedules/:id/run — trigger immediate execution */
  app.post("/api/schedules/:id/run", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { id } = request.params as { id: string };
    const success = triggerJob(id);
    if (!success) {
      return reply.code(404).send({ error: `Job "${id}" not found` });
    }
    return { message: "Job enqueued for immediate execution" };
  });

  /** GET /api/schedules/:id/history — get run history */
  app.get("/api/schedules/:id/history", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { id } = request.params as { id: string };
    const job = getJob(id);
    if (!job) {
      return reply.code(404).send({ error: `Job "${id}" not found` });
    }

    const limit = (request.query as any).limit ? parseInt((request.query as any).limit) : 50;
    const runs = getRunHistory(id, limit);
    return { jobId: id, runs };
  });
}
