module.exports = {
  packagerConfig: {
    asar: true,
    name: 'Cue',
    executableName: 'cue',
    // Bundled public-domain Bible translations (KJV + WEB) and the GHS hymnal
    // seed. Copied into the app's Resources/ dir (outside the asar); Bibles seed
    // on first run, GHS imports on demand from Library → Import → GHS Hymnal.
    extraResource: ['./resources/bible', './resources/ghs'],
  },
  rebuildConfig: {
    extraModules: ['better-sqlite3', 'grandi'],
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: { name: 'cue' },
    },
    {
      name: '@electron-forge/maker-dmg',
      config: { name: 'Cue' },
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-vite',
      config: {
        build: [
          {
            entry: 'src/main/index.js',
            config: 'vite.main.config.js',
            target: 'main',
          },
          {
            entry: 'src/main/preload.js',
            config: 'vite.preload.config.js',
            target: 'preload',
          },
          {
            entry: 'src/main/output-preload.js',
            config: 'vite.preload.config.js',
            target: 'preload',
          },
        ],
        renderer: [
          {
            name: 'main_window',
            config: 'vite.renderer.config.js',
          },
        ],
      },
    },
  ],
};
