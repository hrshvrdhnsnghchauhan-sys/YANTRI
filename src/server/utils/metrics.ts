/**
 * YANTRI Prometheus Metrics
 * Exposes /metrics endpoint for Prometheus scraping
 */

import promClient, { Counter, Histogram, Gauge, collectDefaultMetrics, Registry } from "prom-client";

export const register = new Registry();

// Collect default Node.js metrics (CPU, memory, event loop, etc.)
collectDefaultMetrics({ register, prefix: "yantri_" });

// HTTP request metrics
export const httpRequestsTotal = new Counter({
  name: "yantri_http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "path", "status_code"],
  registers: [register],
});

export const httpRequestDuration = new Histogram({
  name: "yantri_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "path", "status_code"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// WebSocket metrics
export const wsConnectionsActive = new Gauge({
  name: "yantri_ws_connections_active",
  help: "Number of active WebSocket connections",
  registers: [register],
});

export const wsMessagesTotal = new Counter({
  name: "yantri_ws_messages_total",
  help: "Total number of WebSocket messages",
  labelNames: ["direction", "type"],
  registers: [register],
});

// Tool execution metrics
export const toolExecutionsTotal = new Counter({
  name: "yantri_tool_executions_total",
  help: "Total number of tool executions",
  labelNames: ["tool", "status"],
  registers: [register],
});

export const toolExecutionDuration = new Histogram({
  name: "yantri_tool_execution_duration_seconds",
  help: "Tool execution duration in seconds",
  labelNames: ["tool"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [register],
});

// Memory/reminder metrics
export const memoriesTotal = new Gauge({
  name: "yantri_memories_total",
  help: "Total number of stored memories",
  registers: [register],
});

export const remindersActive = new Gauge({
  name: "yantri_reminders_active",
  help: "Number of active reminders",
  registers: [register],
});

// Agent metrics
export const agentStatus = new Gauge({
  name: "yantri_agent_status",
  help: "Desktop agent status (1 = online, 0 = offline)",
  registers: [register],
});

// Error metrics
export const errorsTotal = new Counter({
  name: "yantri_errors_total",
  help: "Total number of errors",
  labelNames: ["type", "endpoint"],
  registers: [register],
});

// Helper to record HTTP request
export function recordHttpRequest(
  method: string,
  path: string,
  statusCode: number,
  durationSeconds: number
) {
  httpRequestsTotal.inc({ method, path, status_code: statusCode });
  httpRequestDuration.observe({ method, path, status_code: statusCode }, durationSeconds);
}

// Helper to record tool execution
export function recordToolExecution(tool: string, success: boolean, durationSeconds: number) {
  toolExecutionsTotal.inc({ tool, status: success ? "success" : "error" });
  toolExecutionDuration.observe({ tool }, durationSeconds);
}

// Metrics endpoint handler
export async function metricsHandler(_req: any, res: any) {
  try {
    res.set("Content-Type", register.contentType);
    res.send(await register.metrics());
  } catch (e) {
    res.status(500).send("Error generating metrics");
  }
}

export function getMetricsContentType(): string {
  return register.contentType;
}