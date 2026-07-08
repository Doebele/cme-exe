.PHONY: help start stop restart logs build backup restore clean health

help:
	@echo "CME.exe — AI × Design Lab"
	@echo ""
	@echo "  make start    — Start container"
	@echo "  make stop     — Stop container"
	@echo "  make restart  — Restart container"
	@echo "  make logs     — Tail logs"
	@echo "  make build    — Rebuild & restart"
	@echo "  make backup   — Create data/ backup"
	@echo "  make restore  — Restore last backup"
	@echo "  make health   — Show /api/health"
	@echo "  make clean    — ⚠ Delete container + data"

start:
	docker compose up -d

stop:
	docker compose down

restart:
	docker compose restart

logs:
	docker compose logs -f

build:
	docker compose build --no-cache
	docker compose up -d

backup:
	@chmod +x backup.sh && ./backup.sh

restore:
	@echo "Restoring last backup…"
	@LATEST=$$(ls -1t backups/*.tar.gz 2>/dev/null | head -1); \
	 if [ -z "$$LATEST" ]; then echo "No backups found"; exit 1; fi; \
	 docker compose down; \
	 rm -rf data; \
	 tar -xzf "$$LATEST"; \
	 echo "✓ Restored: $$LATEST"; \
	 docker compose up -d

clean:
	@echo "⚠  This will delete the container AND data!"
	@read -p "Continue? [y/N] " -n 1 -r; echo; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		docker compose down -v; \
		rm -rf data/runs data/recordings; \
		echo "✓ Done"; \
	fi

health:
	@curl -s http://localhost:8093/api/health | python3 -m json.tool
