/**
 * YANTRI OpenAPI/Swagger Configuration
 * API documentation for REST endpoints
 */

import swaggerJsdoc from "swagger-jsdoc";
import { IS_PRODUCTION } from "@config/index";
import { generateZodSchemas } from "./openapi";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "YANTRI AI Voice Assistant API",
      version: "1.0.0",
      description: `
YANTRI is a real-time, voice-to-voice holographic AI companion desktop assistant 
built on the Google Gemini Live API. This API provides REST endpoints for managing
memories, reminders, user data, Google services, and more.

## Authentication
Most endpoints require authentication via the WebSocket connection. The REST API
is primarily used for configuration and data management.

## WebSocket
Real-time voice communication happens via WebSocket at \`/live\`. See the 
WebSocket documentation for details.
      `,
      contact: {
        name: "YANTRI Team",
        url: "https://github.com/yantri",
      },
      license: {
        name: "MIT",
        url: "https://opensource.org/licenses/MIT",
      },
    },
    servers: [
      {
        url: IS_PRODUCTION ? "https://api.yantri.ai" : "http://localhost:3000",
        description: IS_PRODUCTION ? "Production server" : "Development server",
      },
    ],
    tags: [
      { name: "memories", description: "Persistent memory management" },
      { name: "reminders", description: "Timer-based reminders" },
      { name: "userdata", description: "User data records (deadlines, notes, etc.)" },
      { name: "profile", description: "User profile and onboarding" },
      { name: "google", description: "Google Calendar, Gmail, Tasks" },
      { name: "youtube", description: "YouTube search and playback" },
      { name: "weather", description: "Weather information" },
      { name: "news", description: "News headlines" },
      { name: "search", description: "Tavily AI-powered search" },
      { name: "settings", description: "User preferences" },
      { name: "system", description: "System health and metrics" },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-API-Key",
          description: "API key for authentication",
        },
      },
      schemas: {
        Memory: {
          type: "object",
          properties: {
            id: { type: "string" },
            category: { type: "string", enum: ["identity", "preference", "goal", "project", "relationship", "emotional", "behavior"] },
            text: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        MemoryCreate: {
          type: "object",
          required: ["category", "text"],
          properties: {
            category: { type: "string", enum: ["identity", "preference", "goal", "project", "relationship", "emotional", "behavior"] },
            text: { type: "string", maxLength: 500 },
          },
        },
        Reminder: {
          type: "object",
          properties: {
            id: { type: "string" },
            text: { type: "string" },
            fireAt: { type: "string", format: "date-time" },
            createdAt: { type: "string", format: "date-time" },
            fired: { type: "boolean" },
          },
        },
        ReminderCreate: {
          type: "object",
          required: ["text", "minutes"],
          properties: {
            text: { type: "string", maxLength: 200 },
            minutes: { type: "number", minimum: 0.1, maximum: 10080 },
          },
        },
        UserRecord: {
          type: "object",
          properties: {
            id: { type: "string" },
            email: { type: "string" },
            type: { type: "string" },
            title: { type: "string" },
            payload: { type: "object" },
            due: { type: "string", format: "date-time", nullable: true },
            tags: { type: "array", items: { type: "string" } },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        UserRecordCreate: {
          type: "object",
          required: ["type", "title"],
          properties: {
            type: { type: "string" },
            title: { type: "string" },
            payload: { type: "object", additionalProperties: true },
            due: { type: "string", format: "date-time" },
            tags: { type: "array", items: { type: "string" } },
          },
        },
        UserProfile: {
          type: "object",
          properties: {
            email: { type: "string", format: "email" },
            name: { type: "string" },
            role: { type: "string", enum: ["student", "professional", "business_owner"] },
            features: { type: "array", items: { type: "string" } },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        Error: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
        HealthResponse: {
          type: "object",
          properties: {
            status: { type: "string" },
            timestamp: { type: "string", format: "date-time" },
          },
        },
      },
    },
  },
  apis: ["./src/server/routes/*.ts"],
};

// Merge schemas generated from the Zod validation layer (issue 19) over the
// hand-written component schemas so the spec matches runtime validation.
(options.definition as any).components.schemas = {
  ...((options.definition as any).components.schemas || {}),
  ...generateZodSchemas(),
};

export const swaggerSpec = swaggerJsdoc(options);