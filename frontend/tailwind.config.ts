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
        // Cool jade accent keeps actions distinct from the glass surfaces.
        brand: {
          50: "#DDFBF2",
          100: "#B7F3E2",
          200: "#83E8CC",
          300: "#55D9B7",
          400: "#31C5A4",
          500: "#0D7665",
          600: "#0B6458",
          700: "#0A5249",
        },
        // 中性色：承载 90% 的界面，文字用透明度而非常量灰，叠在任何底色上都可读
        ink: {
          primary: "#ECF5F2",
          secondary: "#B6C9C3",
          tertiary: "#91A7A0",
          disabled: "#62756E",
        },
        line: {
          base: "rgba(207,235,225,0.2)",
          split: "rgba(207,235,225,0.11)",
        },
        surface: {
          DEFAULT: "rgba(20,34,32,0.78)",
          layout: "#0A1212",
          header: "rgba(230,250,243,0.045)",
          fill: "rgba(230,250,243,0.065)",
        },
        // 语义色（浅底 + 深字成对使用，见 StatusTag）
        state: {
          "success-bg": "rgba(46,171,117,0.14)",
          "success-fg": "#9AEFC6",
          "info-bg": "rgba(42,150,162,0.15)",
          "info-fg": "#9be5ed",
          "warning-bg": "rgba(173,119,42,0.17)",
          "warning-fg": "#ffd493",
          "error-bg": "rgba(173,54,69,0.18)",
          "error-fg": "#ffb2b7",
        },
      },
      borderRadius: {
        sm: "2px",
        md: "4px",
        control: "6px",
        card: "8px",
      },
      boxShadow: {
        card: "0 16px 42px rgba(0,0,0,0.2), inset 0 1px rgba(255,255,255,0.08)",
        popup: "0 28px 80px rgba(0,0,0,0.5), inset 0 1px rgba(255,255,255,0.1)",
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
