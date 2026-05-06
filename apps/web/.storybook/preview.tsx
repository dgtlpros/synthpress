import type { Preview, Decorator } from "@storybook/react";
import { useEffect, type ReactNode } from "react";
import "../src/app/globals.css";

function StorybookThemeShell({
  theme,
  padding,
  children,
}: {
  theme: string;
  padding: string | undefined;
  children: ReactNode;
}) {
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme]);

  return (
    <div
      style={{
        background: "var(--background)",
        color: "var(--foreground)",
        minHeight: "100%",
        padding,
      }}
    >
      {children}
    </div>
  );
}

const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme || "light";
  const padding = context.parameters.layout === "centered" ? undefined : "1rem";
  return (
    <StorybookThemeShell theme={theme} padding={padding}>
      <Story />
    </StorybookThemeShell>
  );
};

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Toggle light/dark mode",
      toolbar: {
        title: "Theme",
        icon: "circlehollow",
        items: [
          { value: "light", icon: "sun", title: "Light" },
          { value: "dark", icon: "moon", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: "light",
  },
  decorators: [withTheme],
  parameters: {
    backgrounds: { disable: true },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
