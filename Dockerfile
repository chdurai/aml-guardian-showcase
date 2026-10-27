FROM python:3.12-slim AS base
WORKDIR /app

COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir . && \
    useradd -r -u 10001 appuser
USER appuser

COPY evals ./evals
COPY tests ./tests

# default: run the demo end-to-end with the deterministic stub model
CMD ["python", "-m", "aml_guardian.demo"]
