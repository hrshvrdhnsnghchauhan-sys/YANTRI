# YANTRI Dockerfile
# Multi-stage build for production deployment

# =============================================================================
# Stage 1: Base Node.js image with build dependencies
# =============================================================================
FROM node:20-alpine AS base

# Install system dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    openssl \
    ca-certificates

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production && npm cache clean --force

# =============================================================================
# Stage 2: Frontend build
# =============================================================================
FROM base AS frontend-build

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source files
COPY . .

# Build frontend
RUN npm run build

# =============================================================================
# Stage 3: Python Agent
# =============================================================================
FROM python:3.11-slim AS agent-build

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app/agent

# Copy Python requirements
COPY agent/requirements.txt ./

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Shared, world-readable browser cache so the non-root runtime user can launch Chromium.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN playwright install chromium --with-deps && chmod -R 755 /ms-playwright

# Copy agent source
COPY agent/ ./

# Hardening: drop privileges for the desktop agent (was running as root).
RUN useradd --create-home --uid 1001 --shell /usr/sbin/nologin yantri \
    && chown -R yantri:yantri /app/agent
USER yantri

# Start the FastAPI agent (previously the stage had no CMD, so it never ran).
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8765"]

# =============================================================================
# Stage 4: Production Runtime
# =============================================================================
FROM node:20-alpine AS production

# Install runtime dependencies
RUN apk add --no-cache \
    python3 \
    py3-pip \
    tini \
    dumb-init \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 -S yantri && \
    adduser -S -D -H -u 1001 -h /app -s /sbin/nologin -G yantri -g yantri yantri

# Set working directory
WORKDIR /app

# Copy built frontend
COPY --from=frontend-build --chown=yantri:yantri /app/dist ./dist

# Copy Node.js dependencies
COPY --from=base --chown=yantri:yantri /app/node_modules ./node_modules
COPY --from=base --chown=yantri:yantri /app/package*.json ./

# Copy Python agent
COPY --from=agent-build --chown=yantri:yantri /app/agent ./agent

# Copy server source
COPY --chown=yantri:yantri src/server ./src/server
COPY --chown=yantri:yantri *.json ./

# Create data and logs directories
RUN mkdir -p /app/data/logs && chown -R yantri:yantri /app/data

# Switch to non-root user
USER yantri

# Environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    CLOUD_MODE=true \
    YANTRI_AGENT_HOST=127.0.0.1 \
    YANTRI_AGENT_PORT=8765 \
    YANTRI_BROWSER_MODE=managed \
    PYTHONUNBUFFERED=1

# Expose ports
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Use tini for proper signal handling
ENTRYPOINT ["tini", "--"]

# Start server
CMD ["node", "dist/server.cjs"]