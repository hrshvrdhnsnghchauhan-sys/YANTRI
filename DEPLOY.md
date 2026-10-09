# YANTRI Deployment Guide

Complete guide for deploying YANTRI AI Voice Assistant to production.

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Environment Variables](#environment-variables)
3. [Docker Deployment](#docker-deployment)
4. [Render Deployment](#render-deployment)
5. [Manual Server Deployment](#manual-server-deployment)
6. [Google OAuth Setup](#google-oauth-setup)
7. [Persistent Storage](#persistent-storage)
8. [Monitoring & Health Checks](#monitoring--health-checks)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Node.js 18+** (for frontend/backend)
- **Python 3.10+** (for desktop agent)
- **Docker & Docker Compose** (for containerized deployment)
- **Google Cloud Project** (for Gemini API & Google OAuth)
- **Tavily Account** (for AI search - optional)
- **S3-compatible Storage** (Cloudflare R2, AWS S3, Backblaze B2 - for persistent state)

---

## Environment Variables

Copy `.env.example` to `.env` and fill in required values:

```bash
cp .env.example .env
```

### Required (All Deployments)
| Variable | Description | Example |
|----------|-------------|---------|
| `GEMINI_API_KEY` | Google Gemini API key (required for AI) | `AI...` |
| `TAVILY_API_KEY` | Tavily AI search API key | `tvly-...` |

### Required for Desktop Agent (Local)
| Variable | Description | Default |
|----------|-------------|---------|
| `YANTRI_AGENT_HOST` | Python agent host | `127.0.0.1` |
| `YANTRI_AGENT_PORT` | Python agent port | `8765` |
| `YANTRI_BROWSER_MODE` | Browser mode (`managed` or `cdp`) | `managed` |

### Google OAuth (Optional - for Gmail/Calendar/Tasks)
| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret |
| `GOOGLE_REDIRECT_URI` | OAuth redirect URI (auto-detected on Render) |

### Security (Production)
| Variable | Description | Required |
|----------|-------------|----------|
| `ALLOWED_ORIGINS` | Comma-separated allowed CORS origins | Yes (prod) |
| `AGENT_SHARED_SECRET` | Shared secret for Node↔Python auth | Yes (prod) |
| `CLOUD_MODE` | Set to `true` for server-only mode | Yes (Render) |

### Persistent Storage (S3-compatible)
| Variable | Description |
|----------|-------------|
| `S3_ENDPOINT` | S3 endpoint (e.g., `https://<account>.r2.cloudflarestorage.com`) |
| `S3_REGION` | Region (usually `auto`) |
| `S3_BUCKET` | Bucket name |
| `S3_ACCESS_KEY_ID` | Access key |
| `S3_SECRET_ACCESS_KEY` | Secret key |
| `YANTRI_SYNC_ROOT` | Prefix in bucket | `yantri` |
| `YANTRI_SYNC_INTERVAL_MS` | Sync interval (ms) | `300000` |

### LLM Fallbacks (Optional)
| Variable | Description |
|----------|-------------|
| `GROQ_API_KEY` | Groq API key for fallback |
| `GROQ_MODEL` | Groq model | `qwen/qwen3.8-27b` |
| `OPENCODE_API_KEY` | OpenCode API key |
| `OPENCODE_BASE_URL` | OpenCode base URL | `https://opencode.ai/zen/v1` |
| `OPENCODE_MODEL` | OpenCode model | `mimo-v2.6-flash-free` |

---

## Docker Deployment

### Quick Start with Docker Compose

```bash
# 1. Build and start all services
docker-compose up -d --build

# 2. View logs
docker-compose logs -f

# 3. Stop
docker-compose down
```

### Docker Compose Services

| Service | Port | Description |
|---------|------|-------------|
| `yantri-web` | 3000 | Frontend + Node.js API |
| `yantri-agent` | 8765 | Python Desktop Agent |

### Environment File for Docker

Create `docker.env`:
```env
GEMINI_API_KEY=your_key
TAVILY_API_KEY=your_key
CLOUD_MODE=false
ALLOWED_ORIGINS=http://localhost:3000
AGENT_SHARED_SECRET=your_secret
```

Run with:
```bash
docker-compose --env-file docker.env up -d
```

---

## Render Deployment

Render is the recommended platform for server-only deployments.

### 1. Connect Repository
1. Push to GitHub
2. Connect repo in Render Dashboard
3. Select "Web Service"

### 2. Configure Build & Start
```
Build Command: npm install && npm run build
Start Command: npm start
```

### 3. Set Environment Variables
In Render Dashboard → Environment:

**Required:**
- `GEMINI_API_KEY` (Secret)
- `TAVILY_API_KEY` (Secret)
- `CLOUD_MODE=true`
- `NODE_ENV=production`

**Optional:**
- `TAVILY_API_KEY`
- `GROQ_API_KEY`
- `OPENCODE_API_KEY`
- `OPENCODE_BASE_URL`
- `OPENCODE_MODEL`

**Google OAuth:**
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

**Persistent Storage (S3):**
- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID` (Secret)
- `S3_SECRET_ACCESS_KEY` (Secret)

**Security:**
- `ALLOWED_ORIGINS=https://your-app.onrender.com`
- `AGENT_SHARED_SECRET` (Secret)

### 4. Health Check
Path: `/api/config` (configured in `render.yaml`)

### 5. Deploy
Click "Create Web Service" - Render will build and deploy automatically.

---

## Manual Server Deployment

### 1. Server Requirements
- Ubuntu 22.04+ / Debian 12+
- Node.js 18+ (install via NodeSource)
- Python 3.10+ with venv
- Nginx (reverse proxy)
- PM2 (process manager)

### 2. Install Dependencies
```bash
# Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Python
sudo apt-get install -y python3.11 python3.11-venv

# Nginx
sudo apt-get install -y nginx
```

### 3. Setup Application
```bash
# Clone
git clone https://github.com/your-org/yantri.git
cd yantri

# Install Node deps
npm ci

# Python agent
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r agent/requirements.txt
playwright install chromium

# Build frontend
npm run build
```

### 4. Configure Nginx
```nginx
# /etc/nginx/sites-available/yantri
server {
    listen 80;
    server_name your-domain.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    
    # Frontend
    location / {
        root /path/to/yantri/dist;
        try_files $uri $uri/ /index.html;
    }
    
    # API
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
    
    # WebSocket
    location /live {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/yantri /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 5. SSL Certificate
```bash
sudo certbot --nginx -d your-domain.com
```

### 6. PM2 Process Manager
```bash
# Install
npm install -g pm2

# Create ecosystem file
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    {
      name: 'yantri-server',
      script: 'dist/server.cjs',
      cwd: '/path/to/yantri',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        CLOUD_MODE: 'true',
        GEMINI_API_KEY: 'your_key',
        TAVILY_API_KEY: 'your_key',
        CLOUD_MODE: 'true',
        ALLOWED_ORIGINS: 'https://your-domain.com',
        AGENT_SHARED_SECRET: 'your_secret',
      },
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1G',
    }
  ]
};
EOF

# Start
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

---

## Google OAuth Setup

### 1. Google Cloud Console
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create/select project
2. Enable APIs: **Google Calendar API**, **Gmail API**, **Google Tasks API**
3. **Credentials** → **Create Credentials** → **OAuth Client ID**
   - Application type: **Web application**
   - Authorized redirect URIs:
     - Local: `http://localhost:3000/api/google/callback`
     - Render: `https://your-app.onrender.com/api/google/callback`
     - Custom domain: `https://your-domain.com/api/google/callback`

### 2. Configure Environment
```env
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-secret
```

### 3. Authorize
Visit `/api/google/auth` in browser → Grant permissions → Tokens stored in `google_tokens.json`

---

## Persistent Storage

### Cloudflare R2 (Recommended - Free Tier)
1. Create R2 bucket in Cloudflare Dashboard
2. Create API Token with R2 permissions
3. Configure:
```env
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=yantri-data
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

### AWS S3
```env
S3_ENDPOINT=https://s3.us-east-1.amazonaws.com
S3_REGION=us-east-1
S3_BUCKET=yantri-data
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

### Backblaze B2
```env
S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com
S3_REGION=us-west-004
S3_BUCKET=yantri-data
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

### Verify Sync
```bash
# Check sync status
curl https://your-domain.com/api/sync/status

# Manual sync trigger (if implemented)
curl -X POST https://your-domain.com/api/sync/trigger
```

---

## Monitoring & Health Checks

### Health Endpoints
| Endpoint | Description |
|----------|-------------|
| `GET /health` | Basic health check |
| `GET /api/config` | Config status (used by Render) |
| `GET /api/agent-health` | Python agent status |
| `GET /metrics` | Prometheus metrics |
| `GET /docs` | Swagger API docs |

### Prometheus Metrics
Scrape `/metrics` for:
- `yantri_http_requests_total`
- `yantri_http_request_duration_seconds`
- `yantri_ws_connections_active`
- `yantri_tool_executions_total`
- `yantri_tool_execution_duration_seconds`
- `yantri_memories_total`
- `yantri_reminders_active`
- `yantri_agent_status`
- `yantri_errors_total`

### Grafana Dashboard
Import the provided `grafana-dashboard.json` (if available) for visualization.

### Log Files
Logs stored in `DATA_DIR/logs/`:
- `app.log` - Application logs (JSON)
- `error.log` - Error logs
- `commands.log` - Tool execution commands

---

## Troubleshooting

### Common Issues

#### "No Gemini API key configured"
- Ensure `GEMINI_API_KEY` is set in environment
- Check `.env` file exists and is readable

#### "Desktop agent unavailable"
- Check Python agent is running on port 8765
- Verify `AGENT_SHARED_SECRET` matches on both Node and Python
- Check firewall allows localhost:8765

#### "CORS error"
- Verify `ALLOWED_ORIGINS` includes your frontend URL
- Check `credentials: true` in fetch requests

#### "Google OAuth failed"
- Verify redirect URI matches exactly (including trailing slash)
- Check `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
- Ensure APIs are enabled in Google Cloud Console

#### "Python agent won't start"
```bash
# Check Python version
python3.11 --version

# Check dependencies
source .venv/bin/activate
pip install -r agent/requirements.txt

# Check Playwright
playwright install chromium

# Test manually
python -m agent.server
```

#### "S3 sync not working"
- Verify credentials have `PutObject`, `GetObject`, `ListBucket` permissions
- Check bucket exists and region matches
- Test with `aws s3 ls s3://your-bucket --endpoint-url https://...`

#### "WebSocket connection fails"
- Check nginx proxy passes `Upgrade` and `Connection` headers
- Verify `/live` path proxies to Node server
- Check firewall allows WebSocket traffic

### Debug Mode
```bash
# Enable debug logging
DEBUG=true npm run dev

# Or set log level
LOG_LEVEL=debug npm start
```

---

## Security Checklist

- [ ] `GEMINI_API_KEY` set and not committed
- [ ] `AGENT_SHARED_SECRET` set in production
- [ ] `ALLOWED_ORIGINS` restricted to your domains
- [ ] `CLOUD_MODE=true` for server-only deployments
- [ ] HTTPS enforced via Nginx/Render
- [ ] Google OAuth secrets not committed
- [ ] S3 credentials have minimal permissions
- [ ] Rate limiting enabled on `/api/`
- [ ] Helmet CSP configured
- [ ] Non-root user for Docker containers

---

## Rollback Procedure

```bash
# Docker
docker-compose pull
docker-compose up -d

# PM2
pm2 reload yantri-server --update-env

# Manual
git pull
npm ci
npm run build
pm2 reload yantri-server
```

---

## Support

- GitHub Issues: https://github.com/yantri/yantri/issues
- Documentation: https://docs.yantri.ai
- Discord: https://discord.gg/yantri