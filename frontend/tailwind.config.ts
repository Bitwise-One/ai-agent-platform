import type { Config } from "tailwindcss";

/**
 * 设计令牌（对应 AGENTS.md 与 docs 中的企业级规范）
 *
 * 三条硬规则直接体现在下面的 token 里，改动前请先看注释：
 * 1. 圆角上限 8px（radius-card），禁止大圆角，避免「消费级卡片感」；
 * 2. 主色（brand）只用于唯一主操作与关键高亮，页面覆盖率控制在 5% 以内；
 * 3. 状态色只承载语义（成功/警告/错误/信息），不做装饰。
 *
 * 字体不引外链 Google Fonts：控制台必须能离线跑，外链字体在弱网下会拖慢首屏
 * 并造成布局抖动（CLS）。因此走系统字体栈，中文优先苹方/微软雅黑。
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 品牌主色：取自 AI 产品调色板，仅保留色相，不使用渐变
        brand: {
          50: "#F6F1FB",
          100: "#EBE0F7",
          200: "#D6C2EC",
          300: "#B995DC",
          400: "#9C6BC9",
          500: "#7644A7",
          600: "#63398C",
          700: "#4E2C6F",
        },
        // 中性色：承载 90% 的界面，文字用透明度而非常量灰，叠在任何底色上都可读
        ink: {
          primary: "rgba(0,0,0,0.88)",
          secondary: "rgba(0,0,0,0.65)",
          tertiary: "rgba(0,0,0,0.45)",
          disabled: "rgba(0,0,0,0.25)",
        },
        line: {
          base: "#D9D9D9",
          split: "#F0F0F0",
        },
        surface: {
          DEFAULT: "#FFFFFF",
          layout: "#F0F2F5",
          header: "#FAFAFA",
          fill: "#F5F5F5",
        },
        // 语义色（浅底 + 深字成对使用，见 StatusTag）
        state: {
          "success-bg": "#F6FFED",
          "success-fg": "#389E0D",
          "info-bg": "#E6F4FF",
          "info-fg": "#0958D9",
          "warning-bg": "#FFFBE6",
          "warning-fg": "#D48806",
          "error-bg": "#FFF1F0",
          "error-fg": "#CF1322",
        },
      },
      borderRadius: {
        sm: "2px",
        md: "4px",
        control: "6px",
        card: "8px",
      },
      boxShadow: {
        card: "0 1px 2px 0 rgba(0,0,0,0.03), 0 1px 6px -1px rgba(0,0,0,0.02)",
        popup: "0 6px 16px 0 rgba(0,0,0,0.08), 0 3px 6px -4px rgba(0,0,0,0.12)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "PingFang SC",
          "Microsoft YaHei",
          "sans-serif",
        ],
        mono: ["SFMono-Regular", "Consolas", "Menlo", "monospace"],
      },
      fontSize: {
        caption: ["12px", { lineHeight: "1.4" }],
        body: ["14px", { lineHeight: "1.5" }],
        subtitle: ["16px", { lineHeight: "1.5", fontWeight: "500" }],
        title: ["20px", { lineHeight: "1.4", fontWeight: "600" }],
        h1: ["24px", { lineHeight: "1.4", fontWeight: "600" }],
        metric: ["28px", { lineHeight: "1.3", fontWeight: "600" }],
      },
      transitionTimingFunction: {
        // 统一缓动，避免各页面动效节奏不一致
        enterprise: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
    },
  },
  plugins: [],
} satisfies Config;
