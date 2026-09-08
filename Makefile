# Pokémon Chess — operational commands.
#
# Most targets delegate to Kamal. Requires Kamal 2.x (gem install kamal).
#
# First-time setup:
#   1. cp .kamal/secrets.sample .kamal/secrets  && fill in values
#   2. edit config/deploy.yml and replace the TODO(...) markers
#   3. make setup        (builds image, pushes, boots server, boots app)
#
# Regular workflow:
#   make deploy          (rebuild + ship)
#   make logs            (tail app logs)
#   make console         (open a shell inside the running container)

.PHONY: help install build dev test test-balance typecheck gen-data serve \
        docker-build docker-run setup deploy redeploy logs console \
        app-logs restart rollback stop db-pull

help:
	@grep -E '^[a-zA-Z_-]+:.*?##' Makefile | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

install: ## Install Node deps
	npm install

build: ## Typecheck and build the client into dist/
	npm run build

dev: ## Local Vite dev server
	npm run dev

serve: ## Build, then run the real server (client + API) on :8080
	npm run serve:build

test: ## Run the Vitest suite
	npm test

test-balance: ## Run the slow balance measurement (minutes)
	npm run test:balance

typecheck: ## tsc --noEmit
	npm run typecheck

gen-data: ## Regenerate src/data/generated from @pkmn (commit the result)
	npm run gen:data

docker-build: ## Build the Docker image locally
	docker build -t pokemon-chess:local .

docker-run: ## Run the image locally on :8080 with a throwaway database
	docker run --rm -p 8080:8080 -v pokemon_chess_data_local:/app/data pokemon-chess:local

setup: ## First-time Kamal bootstrap on the target host
	kamal setup

deploy: ## Rebuild and ship the latest code
	kamal deploy

redeploy: ## Redeploy without rebuilding (hot roll current image)
	kamal redeploy

logs: ## Stream proxy + app logs
	kamal logs -f

app-logs: ## Stream just app container logs
	kamal app logs -f

console: ## Open a shell inside the running container
	kamal app exec --interactive --reuse sh

restart: ## Restart the app containers
	kamal app restart

rollback: ## Roll back to the previous image version
	kamal rollback

stop: ## Stop the app (leaves the proxy up)
	kamal app stop

db-pull: ## Copy the live SQLite database down to ./backup/ (accounts are the one thing that cannot be rebuilt)
	mkdir -p backup
	kamal app exec --reuse "cat /app/data/pokemon-chess.db" > backup/pokemon-chess-$$(date +%Y%m%d-%H%M%S).db
