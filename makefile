# Variables
ENV ?= development
COMPOSE = docker compose$(if $(filter production,$(ENV)), -f docker-compose.yml)

SERVICE ?=  # Default service
CMD ?= # Optional command to run

.PHONY: build up down logs shell

build:
	$(COMPOSE) build

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down --remove-orphans $(SERVICE)

logs:
	$(COMPOSE) logs -f $(SERVICE)

shell:
	$(COMPOSE) exec $(SERVICE) sh

# Application commands
.PHONY: lint run-unit-tests

lint:
	$(COMPOSE) exec app npm run lint
	$(COMPOSE) exec server npm run lint

run-unit-tests:
	$(COMPOSE) exec server npm run tests

# General commands
.PHONY: prune
prune:
	docker system prune -af --volumes

.PHONY: restart-all
restart-all:
	docker restart $$(docker ps -aq)

# Restart specific service
.PHONY: restart
restart:
ifeq ($(SERVICE),)
	@echo "Please provide a service name: make restart SERVICE=<service-name>"
	@exit 1
else
	docker compose restart $(SERVICE)
endif
# Development utilities
.PHONY: ps
ps:
	docker ps

# Help
.PHONY: help
help:
	@echo "Usage: make [target] [ENV=development|production] [SERVICE=service_name] [CMD=command]"
	@echo ""
	@echo "Docker Compose Commands:"
	@echo "  up              : Start containers (default: development)"
	@echo "  down            : Stop containers"
	@echo "  logs            : View logs (optional: SERVICE=service_name)"
	@echo "  shell           : Open shell in container (optional: SERVICE=service_name)"
	@echo ""
	@echo "Application Commands:"
	@echo "  lint            : Run linter for app, server, and qa services"
	@echo ""
	@echo "Utility Commands:"
	@echo "  ps              : List running containers"
	@echo "  prune           : Remove all unused containers, networks, images"
	@echo "  restart         : Restart all running containers"
	@echo ""
	@echo "Examples:"
	@echo "  make up                     # Start development environment"
	@echo "  make up ENV=production      # Start production environment"
	@echo "  make logs SERVICE=webapp       # View webapp service logs"
	@echo "  make shell SERVICE=server   # Open shell in server container"

.DEFAULT_GOAL := help