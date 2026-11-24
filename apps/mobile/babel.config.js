// apps/mobile/babel.config.js · Expo SDK 58 preset. babel-preset-expo already includes the expo-router plugin
// and React Native JSX transform, so no extra plugins are needed for this app.
module.exports = function (api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
