/**
 * YANTRI — environment bootstrap.
 *
 * Several server modules resolve `process.env` into constants at module-eval
 * time (IS_CLOUD_MODE, DESKTOP_AGENT_URL, DATA_DIR, storage config, ...).
 * server.ts used to call dotenv.config() at the END of its import chain, so
 * those constants captured values from before `.env` was parsed — silently
 * wrong for any flag only set in `.env` (host-provided env vars were never
 * affected). Importing this module FIRST guarantees every later module sees
 * the full .env. dotenv never overrides variables that are already set, so
 * host/shell env still wins over .env, and the later dotenv.config() inside
 * server.ts remains a harmless no-op kept for standalone-bundle safety.
 */
import dotenv from "dotenv";

dotenv.config();
