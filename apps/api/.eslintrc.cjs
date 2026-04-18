/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ['@klaro/eslint-config/node'],
  env: {
    node: true,
    es2022: true,
  },
};
