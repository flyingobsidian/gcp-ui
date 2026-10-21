default: build

BINARY := gcp-ui
FRONTEND_STAMP := frontend/node_modules/.package-lock.json

# gcloud-go is linked in as a Go module. By default the version pinned in
# go.mod is used; `make gcloud-go-local` switches to a local checkout through
# a (gitignored) go.work file, and `make gcloud-go-versioned` switches back.
GCLOUD_GO := github.com/flyingobsidian/gcloud-go
GCLOUD_GO_DIR ?= ../gcloud-go
REF ?= main
# Version stamped into gcloud-go's `gcloud version` output: the module version,
# or "local:<dir>" when building against a go.work checkout.
GCLOUD_GO_VERSION = $(shell go list -m -f '{{if .Version}}{{.Version}}{{else}}local:{{.Dir}}{{end}}' $(GCLOUD_GO))

.PHONY: build go-build frontend frontend-deps frontend-test frontend-typecheck run test test-v vet fmt lint clean \
	gcloud-go-local gcloud-go-versioned gcloud-go-update gcloud-go-which

build: frontend go-build

go-build:
	CGO_ENABLED=0 go build -ldflags="-s -w -X $(GCLOUD_GO)/cmd.Version=$(GCLOUD_GO_VERSION)" -o bin/$(BINARY) .

gcloud-go-local:
	@test -f $(GCLOUD_GO_DIR)/go.mod || (echo "no gcloud-go checkout at $(GCLOUD_GO_DIR); set GCLOUD_GO_DIR"; exit 1)
	@test -f go.work || go work init .
	go work use $(GCLOUD_GO_DIR)
	@$(MAKE) --no-print-directory gcloud-go-which

gcloud-go-versioned:
	rm -f go.work go.work.sum
	@$(MAKE) --no-print-directory gcloud-go-which

# Pin a different gcloud-go commit, branch or tag in go.mod, e.g. `make gcloud-go-update REF=582.0.0`.
gcloud-go-update:
	GOWORK=off go get $(GCLOUD_GO)@$(REF)
	GOWORK=off go mod tidy
	@$(MAKE) --no-print-directory gcloud-go-which

gcloud-go-which:
	@echo "gcloud-go: $(GCLOUD_GO_VERSION)"

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
