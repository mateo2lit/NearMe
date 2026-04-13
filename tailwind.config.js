/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          bg: "#0a0a0f",
          card: "#16161f",
          border: "#2a2a3a",
          text: "#e4e4ef",
          muted: "#8888a0",
        },
        accent: {
          primary: "#6c5ce7",
          secondary: "#00cec9",
          hot: "#ff6b6b",
          warm: "#ffa502",
        },
      },
    },
  },
  plugins: [],
};
