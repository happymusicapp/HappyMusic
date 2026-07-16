// Ponto de entrada empacotado (esbuild) só pra registrar o runtime do
// Capacitor e os plugins nativos usados pelo app. Não é importado
// diretamente pelas páginas — o resultado empacotado (js/capacitor-bundle.js)
// é que é carregado via <script> no index.html, antes dos demais arquivos.
//
// Depois de carregado, os plugins ficam disponíveis em
// window.Capacitor.Plugins.<NomeDoPlugin>, e são consumidos através do
// js/native-bridge.js (que é um arquivo normal, não empacotado).
import { Capacitor } from '@capacitor/core';
import '@jofr/capacitor-media-session';
import '@capacitor/filesystem';
import '@capacitor/app';
import '@capacitor/browser';

window.Capacitor = Capacitor;
