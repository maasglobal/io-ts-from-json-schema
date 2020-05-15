module.exports = {
  globals: {
    'ts-jest': {
      diagnostics: {
        ignoreCodes: [6133, 6196],
      },
    },
  },
  transform: {
    '^.+\\.(t|j)sx?$': 'ts-jest',
  },
  roots: ['src'],
};
