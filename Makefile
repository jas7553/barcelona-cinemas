build-ApiFunction:
	pip install -r requirements.txt -t $(ARTIFACTS_DIR)/ --no-cache-dir
	cp app.py cache.py enricher.py listings_config.py models.py \
	   observability.py pipeline.py transform.py validation.py $(ARTIFACTS_DIR)/
	cp cinemas.json $(ARTIFACTS_DIR)/
	cp -r scrapers/ $(ARTIFACTS_DIR)/scrapers/
	cp -r providers/ $(ARTIFACTS_DIR)/providers/
