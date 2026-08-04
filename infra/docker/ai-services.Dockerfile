# infra/docker/ai-services.Dockerfile · FastAPI inference service, non-root.
#   docker build -f infra/docker/ai-services.Dockerfile -t <ECR>/krishalaya-ai-services:<tag> apps/ai-services
# (context = apps/ai-services)
FROM python:3.11-slim AS runtime
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PORT=8000
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends tini curl \
  && rm -rf /var/lib/apt/lists/* && useradd -m app
COPY pyproject.toml ./
RUN pip install --upgrade pip && pip install .
COPY src ./src
USER app
EXPOSE 8000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
