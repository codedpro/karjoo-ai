import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // `_name` marks a parameter or binding that is intentionally unused
    // (interface-conforming stubs, destructured omissions).
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // Blue/green, candidate and dev-check build outputs (scripts/deploy-web.sh).
    ".next-*/**",
    // Local scratch output, runtime state and logs.
    ".tmp*/**",
    ".karjoo-runtime/**",
    "backups/**",
    "logs/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // افزونه‌ی MV3 پکیج مستقل با lint/build مخصوص خود است.
    "extension/**",
    // نودِ کارگر (worker fleet) هم پکیج مستقل با tsconfig/build/تست مخصوص خود است.
    "worker/**",
  ]),
]);

export default eslintConfig;
