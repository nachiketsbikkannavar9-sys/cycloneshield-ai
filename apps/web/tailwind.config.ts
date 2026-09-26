export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ocean: {
          50: "#effbff",
          100: "#dff6ff",
          500: "#0ea5e9",
          700: "#0369a1",
          900: "#0c4a6e"
        }
      },
      boxShadow: {
        soft: "0 18px 50px -24px rgb(14 116 144 / 0.35)"
      }
    }
  },
  plugins: []
};
