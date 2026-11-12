import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: [".next/**", "node_modules/**", "backend/.venv/**", "next-env.d.ts", "out/**", "build/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default config;
