const js = require('@eslint/js');
const globals = require ("globals");
const config = require("eslint/config");

module.exports = config.defineConfig([
  { files: ["**/*.{js,mjs,cjs}"], plugins: { js }, extends: ["js/recommended"], languageOptions: { globals: globals.browser } },
  { files: ["**/*.js"], languageOptions: { sourceType: "script" } },
]);
