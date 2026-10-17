export function userscriptHeader(version) {
  return `// ==UserScript==
// @name         UploadFit
// @name:zh-CN   传送门 · UploadFit
// @namespace    https://github.com/TenrocZ/uploadfit
// @version      ${version}
// @description  Adapt images and audio to upload requirements locally in your browser.
// @description:zh-CN 在浏览器本地适配图片与音频上传要求，无需 AI 账号。
// @author       TenrocZ
// @license      MIT
// @homepageURL  https://github.com/TenrocZ/uploadfit
// @supportURL   https://github.com/TenrocZ/uploadfit/issues
// @downloadURL  https://raw.githubusercontent.com/TenrocZ/uploadfit/main/dist/uploadfit.user.js
// @updateURL    https://raw.githubusercontent.com/TenrocZ/uploadfit/main/dist/uploadfit.meta.js
// @match        https://*/*
// @match        http://*/*
// @run-at       document-idle
// @grant        none
// @sandbox      raw
// @inject-into  page
// @noframes
// ==/UserScript==
`;
}
