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

  // ── Navegador externo (login do Google) ────────
  // O Google bloqueia login OAuth feito dentro de uma WebView embutida
  // (é assim que o app roda no Capacitor) — por política de segurança
  // deles, não dá pra contornar. A solução é abrir o login numa aba
  // do Chrome de verdade (Custom Tab) e, quando o Google redirecionar
  // de volta pro domínio do app, o Android entrega essa URL de volta
  // pro app através do App Links (ver AndroidManifest.xml).
  const browserPlugin = isNative && global.Capacitor.Plugins
    ? global.Capacitor.Plugins.Browser
    : null;
  const appPlugin = isNative && global.Capacitor.Plugins
    ? global.Capacitor.Plugins.App
    : null;

  const NativeBrowser = {
    isNative: !!browserPlugin,

    async open(url) {
      if (browserPlugin) {
        try { await browserPlugin.open({ url }); return; }
        catch (err) { console.warn('[NativeBrowser] open falhou:', err); }
      }
      window.location.href = url;
    },

    async close() {
      if (!browserPlugin) return;
      try { await browserPlugin.close(); }
      catch { /* já pode ter sido fechado pelo usuário, ignora */ }
    },
  };

  const NativeApp = {
    isNative: !!appPlugin,

    // handler(url: string) é chamado toda vez que o app é reaberto por
    // um link (ex.: voltando do login do Google).
    onUrlOpen(handler) {
      if (!appPlugin) return;
      appPlugin.addListener('appUrlOpen', (data) => {
        if (data && data.url) handler(data.url);
      });
    },
  };

  global.NativeBrowser = NativeBrowser;
  global.NativeApp = NativeApp;
})(window);
