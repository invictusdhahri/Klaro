/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ['@klaro/eslint-config/next'],
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: './tsconfig.json',
  },
};
