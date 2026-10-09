/**
 * OpenTelemetry tracing (issue 11) — opt-in via OTEL_ENABLED=true.
 *
 * Manual instrumentation (rather than auto-instrumentation) because the server
 * is bundled with esbuild, so runtime require hooks cannot patch modules. Spans
 * are correlated with the pino request id via the http.request_id attribute.
 * Everything is best-effort: tracing must never break a request or boot.
 */
import type { RequestHandler } from "express";
import { OTEL_ENABLED, OTEL_SERVICE_NAME } from "../config";
import { logger } from "./logger";

let tracer: any = null;
let started = false;

export async function initTracing(): Promise<void> {
  if (!OTEL_ENABLED || started) return;
  started = true;
  try {
    const { NodeTracerProvider } = await import("@opentelemetry/sdk-trace-node");
    const { BatchSpanProcessor } = await import("@opentelemetry/sdk-trace-base");
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    const { resourceFromAttributes } = await import("@opentelemetry/resources");
    const semconv: any = await import("@opentelemetry/semantic-conventions");

    const serviceKey = semconv.ATTR_SERVICE_NAME || "service.name";
    const provider = new (NodeTracerProvider as any)({
      resource: (resourceFromAttributes as any)({ [serviceKey]: OTEL_SERVICE_NAME }),
      spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
    });
    provider.register();

    const { trace } = await import("@opentelemetry/api");
    tracer = trace.getTracer("yantri-http");
    logger.info(`[Tracing] OpenTelemetry enabled (service=${OTEL_SERVICE_NAME})`);
  } catch (e: any) {
    logger.warn(`[Tracing] OpenTelemetry init failed, continuing without tracing: ${e?.message || e}`);
  }
}

export function tracingMiddleware(): RequestHandler {
  return (req, res, next) => {
    if (!tracer) return next();
    try {
      const span = tracer.startSpan(`${req.method} ${(req as any).route?.path || req.path}`);
      span.setAttribute("http.method", req.method);
      span.setAttribute("http.target", req.originalUrl || req.url);
      if ((req as any).id) span.setAttribute("http.request_id", (req as any).id);
      res.on("finish", () => {
        try {
          span.setAttribute("http.status_code", res.statusCode);
          if (res.statusCode >= 500) span.setStatus({ code: 2 });
        } finally {
          span.end();
        }
      });
    } catch {
      /* tracing must never break a request */
    }
    next();
  };
}
