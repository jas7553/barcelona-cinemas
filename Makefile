build-ApiFunction:
	pip install -r requirements.txt -t $(ARTIFACTS_DIR)/ --no-cache-dir
	# Copy all root modules via glob so new modules ship automatically.
	# Do NOT hand-enumerate: an omitted file (e.g. reconcile.py) breaks
	# `import app` at runtime and takes down the whole Lambda. Tests live
	# in tests/, so the root *.py glob only matches shippable app modules.
	cp *.py $(ARTIFACTS_DIR)/
	cp cinemas.json $(ARTIFACTS_DIR)/
	cp -r providers/ $(ARTIFACTS_DIR)/providers/
