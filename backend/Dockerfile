# Stage 1: build a static binary. go.mod has no dependencies (standard library only), so there
# is no go.sum to copy and nothing to download.
FROM golang:1.27-alpine AS builder
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# Stage 2: minimal runtime
FROM alpine:3.24
# ca-certificates: HTTPS to GitLab. tzdata: TZ decides which iteration is the current one.
RUN apk --no-cache add ca-certificates tzdata \
    && adduser -D -H -u 10001 app
WORKDIR /app
COPY --from=builder /out/server .
# Numeric, so Kubernetes can check runAsNonRoot
USER 10001:10001
ENV PORT=8080
EXPOSE 8080
# busybox wget is in alpine; the shell form expands PORT if it is overridden.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["./server"]
