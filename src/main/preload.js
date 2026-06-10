import { contextBridge, ipcRenderer } from 'electron';
import { BUNDLED_FONTS, DEFAULT_FONT } from './fonts.js';

contextBridge.exposeInMainWorld('cue', {
  songs: {
    search: (query) => ipcRenderer.invoke('songs:search', query),
    get: (id) => ipcRenderer.invoke('songs:get', id),
    listAll: () => ipcRenderer.invoke('songs:listAll'),
    create: (data) => ipcRenderer.invoke('songs:create', data),
    update: (id, data) => ipcRenderer.invoke('songs:update', id, data),
    delete: (id) => ipcRenderer.invoke('songs:delete', id),
    addTag: (songId, tagId) => ipcRenderer.invoke('songs:addTag', songId, tagId),
    removeTag: (songId, tagId) => ipcRenderer.invoke('songs:removeTag', songId, tagId),
    setBackground: (songId, mediaId) => ipcRenderer.invoke('songs:setBackground', songId, mediaId),
    deleteAll: () => ipcRenderer.invoke('songs:deleteAll'),
  },
  tags: {
    list: () => ipcRenderer.invoke('tags:list'),
    create: (data) => ipcRenderer.invoke('tags:create', data),
    update: (id, data) => ipcRenderer.invoke('tags:update', id, data),
    delete: (id) => ipcRenderer.invoke('tags:delete', id),
  },
  services: {
    list: () => ipcRenderer.invoke('services:list'),
    get: (id) => ipcRenderer.invoke('services:get', id),
    create: (data) => ipcRenderer.invoke('services:create', data),
    update: (id, data) => ipcRenderer.invoke('services:update', id, data),
    delete: (id) => ipcRenderer.invoke('services:delete', id),
    reorderItems: (serviceId, orderedIds) => ipcRenderer.invoke('services:reorderItems', serviceId, orderedIds),
    addItem: (serviceId, item) => ipcRenderer.invoke('services:addItem', serviceId, item),
    removeItem: (itemId) => ipcRenderer.invoke('services:removeItem', itemId),
    setItemBackground: (itemId, mediaId) => ipcRenderer.invoke('services:setItemBackground', itemId, mediaId),
    setItemNotes: (itemId, notes) => ipcRenderer.invoke('services:setItemNotes', itemId, notes),
    duplicateItem: (itemId) => ipcRenderer.invoke('services:duplicateItem', itemId),
    applyBackgroundToRundown: (serviceId, mediaId) => ipcRenderer.invoke('services:applyBackgroundToRundown', serviceId, mediaId),
    clearItems: (serviceId) => ipcRenderer.invoke('services:clearItems', serviceId),
  },
  output: {
    go: (payload) => ipcRenderer.invoke('output:go', payload),
    clear: () => ipcRenderer.invoke('output:clear'),
    logo: () => ipcRenderer.invoke('output:logo'),
    setLive: (enabled) => ipcRenderer.invoke('output:setLive', enabled),
    getState: () => ipcRenderer.invoke('output:getState'),
    media: {
      control: (action) => ipcRenderer.invoke('output:media:control', action),
    },
    channels: {
      list: () => ipcRenderer.invoke('output:channels:list'),
      create: (data) => ipcRenderer.invoke('output:channels:create', data),
      update: (id, data) => ipcRenderer.invoke('output:channels:update', id, data),
      delete: (id) => ipcRenderer.invoke('output:channels:delete', id),
    },
    monitors: {
      list: (channelId) => ipcRenderer.invoke('output:monitors:list', channelId),
      create: (channelId, data) => ipcRenderer.invoke('output:monitors:create', channelId, data),
      delete: (monitorId) => ipcRenderer.invoke('output:monitors:delete', monitorId),
    },
    multiview: {
      start: () => ipcRenderer.invoke('output:multiview:start'),
      stop: () => ipcRenderer.invoke('output:multiview:stop'),
    },
    screens: {
      list: () => ipcRenderer.invoke('output:screens:list'),
    },
  },
  media: {
    import: (filePaths) => ipcRenderer.invoke('media:import', filePaths),
    get: (id) => ipcRenderer.invoke('media:get', id),
    list: (folderId) => ipcRenderer.invoke('media:list', folderId),
    delete: (id) => ipcRenderer.invoke('media:delete', id),
    getDiskUsage: () => ipcRenderer.invoke('media:getDiskUsage'),
    getMediaDir: () => ipcRenderer.invoke('media:getMediaDir'),
    folders: {
      create: (name, parentId) => ipcRenderer.invoke('media:folders:create', name, parentId),
      rename: (id, name) => ipcRenderer.invoke('media:folders:rename', id, name),
      delete: (id) => ipcRenderer.invoke('media:folders:delete', id),
      tree: () => ipcRenderer.invoke('media:folders:tree'),
    },
  },
  bible: {
    versions: () => ipcRenderer.invoke('bible:versions:list'),
    importFile: (filePath, meta) => ipcRenderer.invoke('bible:importFile', filePath, meta),
    delete: (id) => ipcRenderer.invoke('bible:delete', id),
    books: (versionId) => ipcRenderer.invoke('bible:books', versionId),
    resolve: (versionId, ref, versesPerSlide) => ipcRenderer.invoke('bible:resolve', versionId, ref, versesPerSlide),
    search: (versionId, query) => ipcRenderer.invoke('bible:search', versionId, query),
  },
  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
    setGlobalLogo: (mediaId) => ipcRenderer.invoke('settings:setGlobalLogo', mediaId),
    setGlobalBackground: (type, mediaId) => ipcRenderer.invoke('settings:setGlobalBackground', type, mediaId),
    applyBackgroundToAll: (type, mediaId) => ipcRenderer.invoke('settings:applyBackgroundToAll', type, mediaId),
    getDiskUsage: () => ipcRenderer.invoke('settings:getDiskUsage'),
    getDataPath: () => ipcRenderer.invoke('settings:getDataPath'),
    openDataFolder: () => ipcRenderer.invoke('settings:openDataFolder'),
  },
  dialog: {
    openFile: (options) => ipcRenderer.invoke('dialog:openFile', options),
  },
  fonts: {
    list: BUNDLED_FONTS,
    default: DEFAULT_FONT,
  },
  platform: process.platform,
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close:    () => ipcRenderer.invoke('window:close'),
  },
  on: (channel, callback) => {
    const allowed = [
      'output:unresolved-channels', 'output:state-changed',
      'output:ndi-unavailable',
      'output:multiview-captures',
      'shortcut:next', 'shortcut:prev',
    ];
    if (!allowed.includes(channel)) return () => {};
    const wrapper = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, wrapper);
    return () => ipcRenderer.removeListener(channel, wrapper);
  },
  off: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  },
});
