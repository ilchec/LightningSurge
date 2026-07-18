const { jestConfig } = require('@salesforce/sfdx-lwc-jest/config');

module.exports = {
  ...jestConfig,
  moduleNameMapper: {},
  modulePathIgnorePatterns: ['<rootDir>/.localdevserver']
};
