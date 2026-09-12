import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  // 构建产物与第三方压缩文件不该参与 lint。
  // 否则 `pnpm lint`（eslint 不带参数）会把它们一起扫进来：实测 .next 里 23132 项、
  // public/pdf.worker.min.mjs 里 1448 项，合计约 4.9 万条，真正的代码问题全被淹没。
  {
    ignores: [
      ".next/**",
      "dist-installer/**",
      "node_modules/**",
      "public/pdf.worker.min.mjs",
      "next-env.d.ts",
      // 一次性的临时脚本（同样在 .gitignore 里），不属于项目源码
      "add-subcategory.js",
      "extract-tools.js",
      "list-tools.js",
      "remove-tools.js",
      "test-tools*.js",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // Electron 的主进程与 preload 是 CommonJS 环境，本来就必须用 require()。
  // 不关掉这条规则的话，`pnpm lint` 会稳定报 29 个「no-require-imports」假错误，
  // 让 lint 无法当作真正的质量门槛使用。
  {
    files: ["electron/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

export default eslintConfig;
