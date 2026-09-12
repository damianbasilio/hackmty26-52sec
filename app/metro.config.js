const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const contractsRoot = path.resolve(projectRoot, '..', 'contracts');

const config = getDefaultConfig(projectRoot);

// /contracts lives outside the Expo project root, so Metro needs it watched and aliased.
config.watchFolders = [contractsRoot];
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  '@contracts': contractsRoot,
};

module.exports = config;
