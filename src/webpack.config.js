const path = require("path");
const webpack = require("webpack");
const slsw = require("serverless-webpack");
const HardSourceWebpackPlugin = require("hard-source-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const ConcatTextPlugin = require("concat-text-webpack-plugin");
const fs = require("fs");

const config = require("./config");
const jsEslintConfig = require("./eslintrc.json");
//const tsEslintConfig = require("./ts.eslintrc.json");
const ignoreWarmupPlugin = require("./ignore-warmup-plugin");
//const ForkTsCheckerWebpackPlugin = require("fork-ts-checker-webpack-plugin");

const isLocal = slsw.lib.webpack.isLocal;

const servicePath = config.servicePath;
const nodeVersion = config.nodeVersion;
const copyFiles = config.options.copyFiles;
const concatText = config.options.concatText;
const ignorePackages = config.options.ignorePackages;
const tsConfigPath = path.resolve(servicePath, "./tsconfig.json");
const fixPackages = convertListToObject(config.options.fixPackages);

const ENABLE_TYPESCRIPT = fs.existsSync(tsConfigPath);
const ENABLE_STATS = config.options.stats;
const ENABLE_LINTING = config.options.linting;
const ENABLE_SOURCE_MAPS = config.options.sourcemaps;
const ENABLE_CACHING = isLocal ? config.options.caching : false;
const EXTERNALS = config.options.externals;
const NOPARSE = config.options.noParse;

function convertListToObject(list) {
  var object = {};

  for (var i = 0, l = list.length; i < l; i++) {
    object[list[i]] = true;
  }

  return object;
}

function resolveEntriesPath(entries) {
  for (let key in entries) {
    entries[key] = path.join(servicePath, entries[key]);
  }

  return entries;
}

function babelLoader() {
  const plugins = [
    "@babel/plugin-transform-runtime",
    "@babel/plugin-proposal-class-properties"
  ];

  if (ENABLE_SOURCE_MAPS) {
    plugins.push("babel-plugin-source-map-support");
  }

  return {
    loader: "babel-loader",
    options: {
      // Enable caching
      cacheDirectory: ENABLE_CACHING,
      // Disable compresisng cache files to speed up caching
      cacheCompression: false,
      plugins: plugins.map(require.resolve),
      presets: [
        [
          require.resolve("@babel/preset-env"),
          {
            targets: {
              node: nodeVersion
            }
          }
        ]
      ]
    }
  };
}

function eslintLoader() {
  return {
    loader: "eslint-loader",
    options: {
      baseConfig: jsEslintConfig
    }
  };
}

function tsLoader() {
  return {
    loader: "ts-loader",
    options: {
      transpileOnly: true,
      experimentalWatchApi: true
    }
  };
}

function loaders() {
  const loaders = {
    noParse: NOPARSE
      ? NOPARSE.map(function(x) {
          return RegExp(x);
        })
      : [],
    rules: [
      {
        test: /\.(graphql|gql)$/,
        exclude: /node_modules/,
        loader: "graphql-tag/loader"
      }
    ]
  };

  if (ENABLE_TYPESCRIPT) {
    loaders.rules.push({
      test: /\.(ts|js)$/,
      use: [tsLoader()],
      exclude: [
        [
          path.resolve(servicePath, "node_modules"),
          path.resolve(servicePath, ".serverless"),
          path.resolve(servicePath, ".webpack")
        ]
      ]
    });
  } else {
    loaders.rules.push({
      test: /\.js$/,
      exclude: /node_modules/,
      use: [babelLoader()]
    });
  }

  if (ENABLE_LINTING) {
    loaders.rules[0].use.push(eslintLoader());
  }

  return loaders;
}

function plugins() {
  const plugins = [];

  if (ENABLE_TYPESCRIPT) {
    //const forkTsCheckerWebpackOptions = {
    //  tsconfig: path.resolve(servicePath, "./tsconfig.json")
    //};
    //if (ENABLE_LINTING) {
    //  forkTsCheckerWebpackOptions.eslint = true;
    //  forkTsCheckerWebpackOptions.eslintOptions = {
    //    baseConfig: tsEslintConfig
    //  };
    //}
    // this plugin will very quickly run a system out of RAM (10-20GB usage was
    // not uncommon on my desktop), so for now, disable it. this isn't
    // entirely unheard of on this branch:
    // https://github.com/AnomalyInnovations/serverless-bundle/issues/61#issuecomment-586687948
    //
    //plugins.push(new ForkTsCheckerWebpackPlugin(forkTsCheckerWebpackOptions));
  }

  if (ENABLE_CACHING) {
    plugins.push(
      new HardSourceWebpackPlugin({
        info: {
          mode: ENABLE_STATS ? "test" : "none",
          level: ENABLE_STATS ? "debug" : "error"
        }
      })
    );
  }

  if (copyFiles) {
    plugins.push(
      new CopyWebpackPlugin(
        copyFiles.map(function(data) {
          return {
            to: data.to,
            context: servicePath,
            from: path.join(servicePath, data.from)
          };
        })
      )
    );
  }

  if (concatText) {
    const concatTextConfig = {};

    concatText.map(function(data) {
      concatTextConfig.files = data.files || null;
      concatTextConfig.name = data.name || null;
      concatTextConfig.outputPath = data.outputPath || null;
    });

    plugins.push(new ConcatTextPlugin(concatTextConfig));
  }

  // Ignore all locale files of moment.js
  plugins.push(new webpack.IgnorePlugin(/^\.\/locale$/, /moment$/));

  // Ignore any packages specified in the `ignorePackages` option
  for (let i = 0, l = ignorePackages.length; i < l; i++) {
    plugins.push(
      new webpack.IgnorePlugin(new RegExp("^" + ignorePackages[i] + "$"))
    );
  }

  if (fixPackages["formidable@1.x"]) {
    plugins.push(new webpack.DefinePlugin({ "global.GENTLY": false }));
  }

  return plugins;
}

module.exports = ignoreWarmupPlugin({
  entry: resolveEntriesPath(slsw.lib.entries),
  target: "node",
  context: __dirname,
  // Disable verbose logs
  stats: ENABLE_STATS ? "normal" : "errors-only",
  devtool: ENABLE_SOURCE_MAPS ? "source-map" : false,
  // Exclude "aws-sdk" since it's a built-in package
  externals:
    EXTERNALS.length > 0
      ? ["aws-sdk", "knex", "sharp"].concat(EXTERNALS)
      : ["aws-sdk", "knex", "sharp"],
  mode: isLocal ? "development" : "production",
  performance: {
    // Turn off size warnings for entry points
    hints: false
  },
  resolve: {
    // Performance
    symlinks: false,
    extensions: [".wasm", ".mjs", ".js", ".json", ".ts", ".graphql", ".gql"],
    // First start by looking for modules in the plugin's node_modules
    // before looking inside the project's node_modules.
    modules: [path.resolve(__dirname, "node_modules"), "node_modules"]
  },
  // Add loaders
  module: loaders(),
  // PERFORMANCE ONLY FOR DEVELOPMENT
  optimization: isLocal
    ? {
        splitChunks: false,
        removeEmptyChunks: false,
        removeAvailableModules: false
      }
    : // Don't minimize in production
      // Large builds can run out of memory
      { minimize: false },
  plugins: plugins(),
  node: {
    __dirname: false
  }
});
