FROM python:3.11-slim

WORKDIR /app

ENV LANGSMITH_TRACING=true 

ENV LANGSMITH_API_KEY="REDACTED" 

ENV LANGSMITH_ENDPOINT="https://api.smith.langchain.com"

ENV LANGSMITH_PROJECT="vac_proj"

ENV OPENAI_API_KEY="REDACTED" 

ENV PINECONE_API_KEY="REDACTED"

COPY requirements.txt .

RUN pip install --no-cache-dir --upgrade -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
