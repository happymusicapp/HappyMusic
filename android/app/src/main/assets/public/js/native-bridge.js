// Ponte entre o app e o runtime nativo (Capacitor). Este arquivo é
// escrito à mão (não é gerado pelo esbuild) e deve ser carregado DEPOIS
// de js/capacitor-bundle.js e ANTES de js/player.js no index.html.
//
// Dentro do app Android (Capacitor) usa o plugin nativo MediaSession,
// que mantém um foreground service rodando pra tocar áudio com a tela
// bloqueada ou o app em segundo plano. Na versão web (navegador comum,
// em happymusic-crn.pages.dev) cai pra Media Session Web API normal,
// que o Chrome já suporta nativamente.
(function (global) {
  'use strict';

  const isNative = !!(
    global.Capacitor &&
    typeof global.Capacitor.isNativePlatform === 'function' &&
    global.Capacitor.isNativePlatform()
  );

  const plugin = isNative && global.Capacitor.Plugins
    ? global.Capacitor.Plugins.MediaSession
    : null;

  const NativeMedia = {
    isNative: !!plugin,

    async setMetadata({ title, artist, album, artwork }) {
      if (plugin) {
        try { await plugin.setMetadata({ title, artist, album, artwork }); }
        catch (err) { console.warn('[NativeMedia] setMetadata falhou:', err); }
        return;
      }
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album, artwork });
      }
    },

    async setPlaybackState(state) {
      if (plugin) {
        try { await plugin.setPlaybackState({ playbackState: state }); }
        catch (err) { console.warn('[NativeMedia] setPlaybackState falhou:', err); }
        return;
      }
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = state;
      }
    },

    setActionHandler(action, handler) {
      if (plugin) {
        plugin
          .setActionHandler({ action }, handler ? (details) => handler(details) : null)
          .catch(err => console.warn('[NativeMedia] setActionHandler falhou:', err));
        return;
      }
      if ('mediaSession' in navigator) {
        try { navigator.mediaSession.setActionHandler(action, handler); }
        catch { /* ação não suportada neste navegador, ignora */ }
      }
    },

    async setPositionState(state) {
      if (plugin) {
        try { await plugin.setPositionState(state); }
        catch (err) { console.warn('[NativeMedia] setPositionState falhou:', err); }
        return;
      }
      if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) {
        try { navigator.mediaSession.setPositionState(state); }
        catch { /* posição inválida (ex.: duração ainda desconhecida), ignora */ }
      }
    },
  };

  global.NativeMedia = NativeMedia;
})(window);
