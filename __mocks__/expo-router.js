module.exports = {
  useFocusEffect: (effect) => {
    // In test context, just execute the effect immediately
    effect();
  },
};
