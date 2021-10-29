FROM golang:1.17-alpine

RUN apk add gcc musl-dev gdal-dev

COPY . /src
WORKDIR /src
RUN go build

ENV GIN_MODE=release
EXPOSE 8081
CMD ["./radserv"]
