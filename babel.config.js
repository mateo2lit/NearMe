module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      // Must stay last. Required by react-native-reanimated worklets.
      "react-native-reanimated/plugin",
    ],
  };
};
