# -------------------------------------------------------------
# Stage 1: Build the React frontend dashboard
# -------------------------------------------------------------
FROM node:22-slim AS frontend-builder
WORKDIR /app/frontend

# Install pnpm
RUN npm install -g pnpm@10.26.1

# Copy frontend source and build
COPY frontend/ ./
RUN pnpm install --frozen-lockfile
RUN pnpm run build

# -------------------------------------------------------------
# Stage 2: Python FastAPI backend + static frontend server
# -------------------------------------------------------------
FROM python:3.10-slim
WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code and data
COPY src/ ./src/
COPY data/ ./data/

# Copy compiled frontend assets from Stage 1
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Ensure src is in Python path
ENV PYTHONPATH=/app/src
ENV PORT=10000
EXPOSE 10000

# Start server using Render's PORT environment variable
CMD ["sh", "-c", "uvicorn src.web.server:app --host 0.0.0.0 --port ${PORT:-10000}"]
