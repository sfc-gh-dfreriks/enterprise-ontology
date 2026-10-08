import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        sf: {
          primary: "#29B5E8",
          dark: "#11567F",
          deeper: "#0D3B5E",
          light: "#71D3F7",
          pale: "#A3DAF5",
          cyan: "#4DC9F6",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
