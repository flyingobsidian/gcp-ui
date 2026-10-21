default: build

BINARY := gcp-ui
FRONTEND_STAMP := frontend/node_modules/.package-lock.json

.PHONY: build go-build frontend frontend-deps frontend-test frontend-typecheck run test test-v vet fmt lint clean

build: frontend go-build

go-build:
	CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/$(BINARY) .

$(FRONTEND_STAMP): frontend/package.json frontend/package-lock.json
	cd frontend && npm ci --ignore-scripts

frontend-deps: $(FRONTEND_STAMP)

frontend: frontend-deps
	cd frontend && npm run build

frontend-test: frontend-deps
	cd frontend && npm test

frontend-typecheck: frontend-deps
	cd frontend && npm run typecheck

run: build
	./bin/$(BINARY)

fmt:
	go fmt ./...

vet:
	go vet ./...

lint: vet frontend-typecheck
	@test -z "$$(gofmt -l .)" || (echo "gofmt needed:"; gofmt -l .; exit 1)

test: frontend-test
	go test ./...

test-v:
	go test ./... -v

clean:
	rm -f bin/$(BINARY)
	find internal/web/dist -type f ! -name .gitkeep -delete
