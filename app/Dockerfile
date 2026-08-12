FROM python:3.11-slim

WORKDIR /app

# Secrets are NOT baked into the image. Supply these at runtime (Render:
# Environment tab; local: docker run --env-file ../.env):
#   OPENAI_API_KEY        required
#   PINECONE_API_KEY      required for the RAG chat path
#   PINECONE_INDEX_NAME   required for the RAG chat path
#   ANTHROPIC_API_KEY     optional, only for Claude models
#   LANGSMITH_*           optional tracing
# They used to sit here as ENV defaults, which meant a forgotten variable
# produced a confusing auth failure instead of a clear "missing key".
ENV LANGSMITH_ENDPOINT="https://api.smith.langchain.com" \
    LANGSMITH_PROJECT="vac_proj" \
    PYTHONUNBUFFERED=1

COPY requirements.txt .

RUN pip install --no-cache-dir --upgrade -r requirements.txt

COPY . .

EXPOSE 8000

# Shell form so $PORT expands. Hosted platforms (Render, Cloud Run, Fly) assign
# the port and require the process to listen on it; 8000 is the local default.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
