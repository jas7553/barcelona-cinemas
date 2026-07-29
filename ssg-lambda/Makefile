build-SsgFunction:
	# Ship the handler plus the built artifacts copied in by deploy.sh:
	#   entry-server.js  (self-contained React SSR bundle)
	#   render-core.mjs, template.mjs  (render loop + HTML template)
	#   site-constants.mjs             (timezone + prune prefixes)
	#   manifest.json    (Vite client manifest → hashed asset URLs)
	# AWS SDK v3 is provided by the nodejs runtime, so there are no deps to install.
	# Anything index.mjs imports must be listed here — deploy.sh smoke-imports the
	# built package so an omission fails the deploy instead of the prod render.
	cp index.mjs $(ARTIFACTS_DIR)/
	cp package.json $(ARTIFACTS_DIR)/
	cp entry-server.js $(ARTIFACTS_DIR)/
	cp render-core.mjs $(ARTIFACTS_DIR)/
	cp template.mjs $(ARTIFACTS_DIR)/
	cp site-constants.mjs $(ARTIFACTS_DIR)/
	cp manifest.json $(ARTIFACTS_DIR)/
