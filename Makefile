INFRA = postgres redis minio wiremock mailpit

.PHONY: up down logs migrate test sit app-up lint build

up:
	docker compose up -d $(INFRA)

down:
	docker compose down

logs:
	docker compose logs -f

migrate:
	npx prisma migrate deploy

test:
	npm test

sit: up
	npm run test:sit

app-up:
	docker compose --profile app up --build

lint:
	npm run lint

build:
	npm run build
