import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "var(--font-mono)",
          "JetBrains Mono",
          "ui-monospace",
          "Cascadia Code",
          "monospace",
        ],
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: "hsl(var(--card))",
        "card-foreground": "hsl(var(--card-foreground))",
        /** 媒体预览舞台底色（视频/图片/音频的展示底），三套主题下都接近黑 */
        stage: "hsl(var(--stage))",
        popover: "hsl(var(--popover))",
        "popover-foreground": "hsl(var(--popover-foreground))",
        primary: "hsl(var(--primary))",
        "primary-foreground": "hsl(var(--primary-foreground))",
        secondary: "hsl(var(--secondary))",
        "secondary-foreground": "hsl(var(--secondary-foreground))",
        muted: "hsl(var(--muted))",
        "muted-foreground": "hsl(var(--muted-foreground))",
        accent: "hsl(var(--accent))",
        "accent-foreground": "hsl(var(--accent-foreground))",
        destructive: "hsl(var(--destructive))",
        success: "hsl(var(--success))",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 3px)",
        sm: "calc(var(--radius) - 6px)",
      },
      /**
       * Tailwind 3.4 并没有内置 shadow-xs（那是 v4 才有的名字），
       * 而项目里有 134 处在用它 —— 实测那些元素的 box-shadow 全是 none，
       * 也就是说卡片一直只靠边框立骨架，写上去的阴影一点没生效。
       *
       * 这里按项目自己的阴影语言补上（对照 globals.css 里 .spotlight-card 的写法）：
       *   - 内嵌一道极细的高光：用 --foreground 上色，所以浅色主题下是暗色细边、
       *     深色主题下自动变成一道浅色高光，三套主题都成立；
       *   - 外面一层极淡的环境阴影：纯黑低透明度，在浅色/护眼主题下把卡片"托"起来；
       *     深色主题下几乎不可见（那里本来靠边框区分层级，不会变脏）。
       */
      boxShadow: {
        xs: "0 1px 0 0 hsl(var(--foreground) / 0.04) inset, 0 1px 3px -1px rgb(0 0 0 / 0.14)",
      },
    },
  },
  plugins: [],
};

export default config;
