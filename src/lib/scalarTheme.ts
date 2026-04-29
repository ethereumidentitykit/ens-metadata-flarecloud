import type { ApiReferenceConfiguration } from "@scalar/hono-api-reference";

const grailsScalarCss = String.raw`
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Sedan+SC&display=swap');

  @layer scalar-base, scalar-theme, scalar-config;

  :root,
  .light-mode,
  .dark-mode {
    --scalar-font: 'Inter', Arial, sans-serif;
    --scalar-font-code: 'JetBrains Mono', 'Fira Code', 'SFMono-Regular', monospace;

    --scalar-color-1: #ffffff;
    --scalar-color-2: rgba(255, 255, 255, 0.8);
    --scalar-color-3: #aaaaaa;
    --scalar-color-accent: #ffdfc0;

    --scalar-background-1: #222222;
    --scalar-background-2: #333333;
    --scalar-background-3: #444444;
    --scalar-background-accent: rgba(255, 223, 192, 0.08);
    --scalar-border-color: rgba(255, 223, 192, 0.14);
  }

  .dark-mode .sidebar,
  .light-mode .sidebar {
    --scalar-sidebar-background-1: var(--scalar-background-1);
    --scalar-sidebar-item-hover-color: currentColor;
    --scalar-sidebar-item-hover-background: var(--scalar-background-2);
    --scalar-sidebar-item-active-background: var(--scalar-background-2);
    --scalar-sidebar-border-color: var(--scalar-border-color);
    --scalar-sidebar-color-1: var(--scalar-color-1);
    --scalar-sidebar-color-2: var(--scalar-color-3);
    --scalar-sidebar-color-active: var(--scalar-color-accent);
    --scalar-sidebar-search-background: var(--scalar-background-2);
    --scalar-sidebar-search-border-color: var(--scalar-border-color);
    --scalar-sidebar-search-color: var(--scalar-color-3);
  }

  body {
    background:
      radial-gradient(circle at top right, rgba(255, 223, 192, 0.08), transparent 32%),
      #222222;
  }

  .scalar-app,
  .scalar-api-reference {
    background: transparent;
  }

  .scalar-app h1,
  .scalar-app h2,
  .scalar-api-reference h1,
  .scalar-api-reference h2 {
    font-family: 'Sedan SC', 'Inter', serif;
    letter-spacing: 0.02em;
    font-weight: 400;
  }

  .scalar-app a,
  .scalar-api-reference a {
    color: var(--scalar-color-accent);
  }
`;

export const scalarTheme: ApiReferenceConfiguration = {
  cdn: "https://cdn.jsdelivr.net/npm/@scalar/api-reference",
  url: "/openapi.json",
  pageTitle: "ENS Metadata - Flarecloud",
  title: "ENS Metadata - Flarecloud",
  theme: "none",
  layout: "modern",
  forceDarkModeState: "dark",
  hideDarkModeToggle: true,
  withDefaultFonts: false,
  customCss: grailsScalarCss,
};
