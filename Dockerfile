FROM golang:1.25-alpine

RUN apk add gcc musl-dev gdal-dev

WORKDIR /src

COPY go.mod ./
COPY go.sum ./
RUN go mod download

COPY . ./

RUN CGO_LDFLAGS="$CGO_LDFLAGS -lgdal" go build

ENV GIN_MODE=release
EXPOSE 8081
CMD ["./radserv"]
