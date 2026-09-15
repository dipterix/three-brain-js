const webpack = require("webpack");
const path = require('path');
const { WebpackManifestPlugin } = require('webpack-manifest-plugin');
// const HtmlWebpackPlugin = require('html-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
  mode: 'production',
  entry: {
    main    : path.resolve(__dirname, 'src/js/index.js'),
    worker  : path.resolve(__dirname, 'src/js/worker.js'),
  },
  // devtool: 'hidden-source-map',
  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /\.css$/i,
        use: [
          'style-loader',
          'css-loader',
        ]
      },
      {
        test: /\.(jpg|png)$/i,
        use: [
          'file-loader',
        ]
      },
      {
        // see inspector-extensions-loader.js
        test: /[\\/]three[\\/]examples[\\/]jsm[\\/]inspector[\\/]tabs[\\/]Settings\.js$/,
        use: [
          path.resolve(__dirname, 'inspector-extensions-loader.js'),
        ]
      },
      {
        // three's Inspector expects `three` to be the WebGPU build, as in three's
        // own WebGPU examples: the TSL graph hands its `import * as THREE` to the
        // node code it generates. The plain `three` would also pull the WebGL
        // renderer into the bundle.
        test: /[\\/]three[\\/]examples[\\/]jsm[\\/]inspector[\\/]/,
        resolve: {
          alias: { three$: 'three/webgpu' },
        },
      },
    ],
  },
  resolve: {
    fallback: {
      // "stream": require.resolve("stream-browserify")
      "stream": false
    }
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    chunkFormat: "module",
    filename: "threebrain-[name].js",
    publicPath: "/",
    clean : true,
    globalObject: 'this',
    library: {
      name: 'threeBrain',
      type: 'umd',
    },
  },
  plugins: [
    new WebpackManifestPlugin({}),
    // new webpack.SourceMapDevToolPlugin({})
  ],
  optimization: {
    minimize: true,
    minimizer: [new TerserPlugin()],
  }
};
//*/

/*
const path = require('path');

module.exports = {
  mode: 'production',
  entry: path.resolve(__dirname, 'src/index.js'),
  output: {
    filename: 'main.js',
    path: path.resolve(__dirname, '../htmlwidgets/lib/dipterixThreeBrain-1.0.1'),
    // libraryTarget: 'var',
    // library: 'RAVEPipeline'
    publicPath: "/"
  },
  devtool: 'source-map',
};
//*/
