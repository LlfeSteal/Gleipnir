# Fake GitLab for the demo (docker-compose.demo.yml). Never part of a production deployment.
# Stage 1: build a static binary (standard library only: no go.sum, nothing to download).
FROM golang:1.27-alpine AS builder
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/gitlab-mock .

# Stage 2: minimal runtime
FROM alpine:3.24
# tzdata: TZ decides which day is today, so which iteration is the current one.
RUN apk --no-cache add tzdata \
    && adduser -D -H -u 10001 app
WORKDIR /app
COPY --from=builder /out/gitlab-mock .
# Numeric, so Kubernetes can check runAsNonRoot
USER 10001:10001
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/-/health" || exit 1
CMD ["./gitlab-mock"]
