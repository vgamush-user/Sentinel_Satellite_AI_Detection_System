FROM python:3.10-slim

WORKDIR /app

# 1. Copy and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 2. Copy the entire src folder so your imports work perfectly
COPY src/ ./src/

# 3. Expose Cloud Run's default port
EXPOSE 8080

# 4. Run your server (Choose ONE of the options below):

# OPTION A: If server.py uses FastAPI or Flask (Recommended for Web APIs)
CMD ["uvicorn", "src.web.server:app", "--host", "0.0.0.0", "--port", "8080"]

# OPTION B: If server.py is a standard, raw Python websocket/TCP script
# CMD ["python", "src/web/server.py"]
