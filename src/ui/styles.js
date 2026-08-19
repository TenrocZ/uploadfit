const UI_Z_INDEX = 99999;

/**
 * All UploadFit UI styling lives inside the shadow root (compact form: the
 * stylesheet ships as a string literal in the bundle). The reset blocks
 * inherited page styles (U01) and the palette keeps WCAG AA contrast.
 */
export function buildStyleSheet() {
  return ':host{all:initial;font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.5;color:#1f2937}'
    + '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}'
    + '.uf-root{position:fixed;right:16px;bottom:16px;z-index:' + UI_Z_INDEX + ';display:flex;flex-direction:column;align-items:flex-end;gap:8px;max-width:calc(100vw - 24px);font:inherit;color:#1f2937}'
    + '.uf-pill{display:inline-flex;align-items:center;gap:8px;max-width:calc(100vw - 24px);padding:6px 8px 6px 14px;border:1px solid #93c5fd;border-radius:999px;background:#2563eb;color:#fff;font:inherit;font-size:13px;cursor:pointer;box-shadow:0 4px 12px rgba(15,23,42,.25)}'
    + '.uf-pill:hover,.uf-pill:focus-visible{background:#1d4ed8}'
    + '.uf-pill:focus-visible{outline:2px solid #1f2937;outline-offset:2px}'
    + '.uf-pill-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.uf-pill-close{border:none;border-radius:999px;background:rgba(255,255,255,.18);color:#fff;font:inherit;font-size:12px;line-height:1;padding:4px 8px;cursor:pointer}'
    + '.uf-pill-close:hover,.uf-pill-close:focus-visible{background:rgba(255,255,255,.32)}'
    + '.uf-pill-close:focus-visible{outline:2px solid #fff;outline-offset:1px}'
    + '.uf-card{width:360px;max-width:380px;max-height:min(70vh,560px);overflow-y:auto;padding:14px;border:1px solid #d1d5db;border-radius:12px;background:#fff;color:#1f2937;font:inherit;box-shadow:0 10px 30px rgba(15,23,42,.18)}'
    + '.uf-card[hidden]{display:none}'
    + '.uf-card-title{font-size:15px;font-weight:600;color:#111827;margin-bottom:8px}'
    + '.uf-section{margin:8px 0}'
    + '.uf-label{color:#4b5563;font-size:12px}'
    + '.uf-value{font-weight:600;overflow-wrap:anywhere}'
    + '.uf-hint{color:#4b5563;font-size:12px}'
    + '.uf-evidence{margin-top:4px;padding:6px 8px;border-left:3px solid #93c5fd;background:#f8fafc;color:#374151;font-size:12px;overflow-wrap:anywhere}'
    + '.uf-semantic{margin-top:4px;padding:6px 8px;border-left:3px solid #d97706;background:#fffbeb;color:#7c2d12;font-size:12px}'
    + '.uf-conflict{margin-top:6px;padding:8px;border:1px solid #f59e0b;border-radius:8px;background:#fffbeb;color:#92400e;font-size:13px;font-weight:600}'
    + '.uf-rule-list{list-style:none}'
    + '.uf-rule-list li{display:flex;justify-content:space-between;gap:8px;padding:2px 0;font-size:13px}'
    + '.uf-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}'
    + '.uf-button{border:1px solid #9ca3af;border-radius:8px;background:#fff;color:#1f2937;font:inherit;font-size:13px;padding:7px 14px;cursor:pointer}'
    + '.uf-button:hover{background:#f3f4f6}'
    + '.uf-button:focus-visible{outline:2px solid #2563eb;outline-offset:2px}'
    + '.uf-button-primary{background:#2563eb;border-color:#2563eb;color:#fff}'
    + '.uf-button-primary:hover{background:#1d4ed8}'
    + '.uf-status-warn{color:#92400e;font-weight:600}'
    + '.uf-status-error{color:#991b1b;font-weight:600}'
    + '.uf-alert{margin-top:8px;padding:8px;border:1px solid #fca5a5;border-radius:8px;background:#fef2f2;color:#991b1b;font-size:13px}'
    + '.uf-progress{margin-top:8px;height:6px;border-radius:999px;background:#e5e7eb;overflow:hidden}'
    + '.uf-progress-bar{height:100%;width:45%;border-radius:999px;background:#2563eb;animation:uf-slide 1.2s ease-in-out infinite}'
    + '@keyframes uf-slide{0%{transform:translateX(-100%)}100%{transform:translateX(320%)}}'
    + '.uf-preview-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}'
    + '.uf-preview-box{flex:1 1 140px;min-width:120px;border:1px solid #d1d5db;border-radius:8px;overflow:hidden;background:#fff}'
    + '.uf-preview-box img{display:block;width:100%;height:auto}'
    + '.uf-preview-checker{background-image:linear-gradient(45deg,#e5e7eb 25%,transparent 25%),linear-gradient(-45deg,#e5e7eb 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e5e7eb 75%),linear-gradient(-45deg,transparent 75%,#e5e7eb 75%);background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0;background-color:#fff}'
    + '.uf-preview-caption{font-size:12px;color:#4b5563;margin-top:4px;text-align:center}'
    + '.uf-crop-stage{position:relative;margin-top:8px;border:1px solid #d1d5db;border-radius:8px;overflow:hidden;background:#f3f4f6;touch-action:none;user-select:none;-webkit-user-select:none}'
    + '.uf-crop-stage img{display:block;width:100%;height:auto;pointer-events:none}'
    + '.uf-crop-box{position:absolute;border:2px solid #2563eb;box-shadow:0 0 0 9999px rgba(15,23,42,.45);cursor:move;border-radius:2px}'
    + '.uf-crop-box:focus-visible{outline:2px solid #d97706;outline-offset:2px}'
    + '.uf-crop-size{position:absolute;top:6px;left:6px;padding:2px 8px;border-radius:999px;background:rgba(17,24,39,.8);color:#fff;font-size:12px}'
    + '.uf-anchor-row{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}'
    + '.uf-anchor-row .uf-button{padding:4px 10px;font-size:12px}'
    + '.uf-file-input{display:none}'
    + '.uf-live{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}'
    + '.uf-download-link{display:inline-block;margin-top:8px;padding:7px 14px;border:1px solid #16a34a;border-radius:8px;background:#fff;color:#166534;font:inherit;font-size:13px;text-decoration:none;cursor:pointer}'
    + '.uf-download-link:hover{background:#f0fdf4}'
    + '.uf-download-link:focus-visible{outline:2px solid #16a34a;outline-offset:2px}'
    + '@media (max-width:640px){.uf-root{right:12px;bottom:12px}.uf-card{width:calc(100vw - 24px);max-width:calc(100vw - 24px)}}'
    + '@media (prefers-reduced-motion:reduce){.uf-progress-bar{animation:none}.uf-pill,.uf-card,.uf-button,.uf-pill-close{transition:none}}';
}

export { UI_Z_INDEX };
