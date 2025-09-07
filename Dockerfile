# Frontend build stage
FROM node:18-alpine AS frontend-builder

WORKDIR /web
COPY web/package*.json ./
RUN npm ci

COPY web/ ./
RUN npm run build

# Backend build stage
FROM golang:1.25-bookworm AS backend-builder

RUN apt-get update && apt-get install -y \
    build-essential \
    libgdal-dev \
    gdal-bin \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

COPY go.mod ./
COPY go.sum ./
RUN go mod download

COPY . ./
RUN CGO_LDFLAGS="$CGO_LDFLAGS -lgdal" go build

# Final stage
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    gdal-bin \
    libgdal-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && gdal-config --formats

WORKDIR /app

# Copy the backend binary
COPY --from=backend-builder /src/radserv .

# Copy the frontend build
COPY --from=frontend-builder /web/dist ./web/dist

ENV GIN_MODE=release
ENV PORT=8080
EXPOSE $PORT
CMD ["./radserv"]
