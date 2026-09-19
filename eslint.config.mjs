// The lint of this repository: the rules typescript-eslint recommends, over the sources and the
// tests. `dist` is generated and is not linted.
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  { ignores: ["dist/**"] },
  { files: ["src/**/*.ts", "test/**/*.ts"] },
  ...tsPlugin.configs["flat/recommended"],
  {
    rules: {
      // A name that starts with an underscore is unused on purpose: `const { wif: _omit, ...rest }`
      // takes a field out of a copy.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
    },
  },
];
