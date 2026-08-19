/**
 * Aspect-locked cropper preview. The box size is fixed by the rule-derived
 * proposal; the user can only translate it inside the image (top/center/bottom
 * anchors are the keyboard-free fallback). Confirm emits a normalized 0–1
 * rectangle plus the pixel rectangle used for the confirmation payload.
 */
export function createCropper({
  documentRef,
  imageUrl,
  sourceWidth,
  sourceHeight,
  cropWidth,
  cropHeight,
  targetWidth,
  targetHeight,
  onConfirm,
  onCancel
}) {
  const stage = documentRef.createElement('div');
  stage.className = 'uf-crop-stage';
  stage.setAttribute('role', 'group');
  stage.setAttribute('aria-label', '裁剪预览，可拖动或用方向键移动裁剪框');

  const image = documentRef.createElement('img');
  image.alt = '待裁剪的原始图片';
  if (imageUrl) image.src = imageUrl;
  stage.append(image);

  const box = documentRef.createElement('div');
  box.className = 'uf-crop-box';
  box.tabIndex = 0;
  box.setAttribute('role', 'application');
  box.setAttribute('aria-label', '裁剪框，使用方向键移动，按 Esc 取消');
  stage.append(box);

  const sizeLabel = documentRef.createElement('div');
  sizeLabel.className = 'uf-crop-size';
  stage.append(sizeLabel);

  const maxX = Math.max(0, Math.round(sourceWidth) - Math.round(cropWidth));
  const maxY = Math.max(0, Math.round(sourceHeight) - Math.round(cropHeight));
  const state = { x: Math.round(maxX / 2), y: Math.round(maxY / 2), scale: 0 };
  let destroyed = false;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function layout() {
    if (destroyed) return;
    const width = stage.offsetWidth;
    if (!width || !Number.isFinite(sourceWidth) || sourceWidth <= 0) return;
    state.scale = width / sourceWidth;
    box.style.width = `${Math.round(cropWidth * state.scale)}px`;
    box.style.height = `${Math.round(cropHeight * state.scale)}px`;
    box.style.left = `${Math.round(state.x * state.scale)}px`;
    box.style.top = `${Math.round(state.y * state.scale)}px`;
    sizeLabel.textContent = Number.isFinite(targetWidth) && Number.isFinite(targetHeight)
      ? `输出 ${targetWidth} × ${targetHeight} 像素`
      : '输出尺寸待定';
  }

  function moveTo(x, y) {
    state.x = Math.round(clamp(x, 0, maxX));
    state.y = Math.round(clamp(y, 0, maxY));
    layout();
  }

  const anchorRow = documentRef.createElement('div');
  anchorRow.className = 'uf-anchor-row';
  const anchorButtons = [];
  for (const [label, y] of [['顶部', 0], ['居中', Math.round(maxY / 2)], ['底部', maxY]]) {
    const anchor = documentRef.createElement('button');
    anchor.type = 'button';
    anchor.className = 'uf-button';
    anchor.textContent = label;
    anchor.setAttribute('data-uf-action', `crop-anchor-${label}`);
    anchor.addEventListener('click', () => moveTo(state.x, y));
    anchorRow.append(anchor);
    anchorButtons.push(anchor);
  }

  const actions = documentRef.createElement('div');
  actions.className = 'uf-actions';
  const confirmButton = documentRef.createElement('button');
  confirmButton.type = 'button';
  confirmButton.className = 'uf-button uf-button-primary';
  confirmButton.setAttribute('data-uf-action', 'confirm-crop');
  confirmButton.textContent = '确认裁剪';
  const cancelButton = documentRef.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'uf-button';
  cancelButton.setAttribute('data-uf-action', 'cancel-crop');
  cancelButton.textContent = '取消';

  function normalizedRect() {
    return {
      x: state.x / sourceWidth,
      y: state.y / sourceHeight,
      width: cropWidth / sourceWidth,
      height: cropHeight / sourceHeight
    };
  }

  function pixelRect() {
    return {
      x: state.x,
      y: state.y,
      width: Math.round(cropWidth),
      height: Math.round(cropHeight)
    };
  }

  function handleConfirm() {
    if (destroyed) return;
    onConfirm?.({ normalized: normalizedRect(), pixel: pixelRect() });
  }
  confirmButton.addEventListener('click', handleConfirm);
  cancelButton.addEventListener('click', () => {
    if (!destroyed) onCancel?.();
  });

  actions.append(confirmButton, cancelButton);

  let dragPointer = null;
  let dragStart = null;
  let dragMode = 'box';

  function stagePoint(event) {
    const rect = stage.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / (state.scale || 1),
      y: (event.clientY - rect.top) / (state.scale || 1)
    };
  }

  function onPointerDown(event) {
    if (destroyed || event.button !== 0) return;
    dragMode = event.target === box ? 'box' : 'stage';
    dragStart = stagePoint(event);
    dragPointer = event.pointerId;
    stage.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (destroyed || dragPointer !== event.pointerId || !dragStart) return;
    const point = stagePoint(event);
    const deltaX = point.x - dragStart.x;
    const deltaY = point.y - dragStart.y;
    const direction = dragMode === 'box' ? 1 : -1;
    moveTo(state.x + deltaX * direction, state.y + deltaY * direction);
    dragStart = point;
  }

  function onPointerUp(event) {
    if (dragPointer === event.pointerId) {
      stage.releasePointerCapture?.(event.pointerId);
      dragPointer = null;
      dragStart = null;
    }
  }

  function onBoxKeyDown(event) {
    if (destroyed) return;
    const stepX = maxX > 0 ? Math.max(1, Math.round(sourceWidth * 0.01)) : 0;
    const stepY = maxY > 0 ? Math.max(1, Math.round(sourceHeight * 0.01)) : 0;
    const multiplier = event.shiftKey ? 10 : 1;
    let handled = true;
    switch (event.key) {
      case 'ArrowLeft': moveTo(state.x - stepX * multiplier, state.y); break;
      case 'ArrowRight': moveTo(state.x + stepX * multiplier, state.y); break;
      case 'ArrowUp': moveTo(state.x, state.y - stepY * multiplier); break;
      case 'ArrowDown': moveTo(state.x, state.y + stepY * multiplier); break;
      case 'Home': moveTo(0, state.y); break;
      case 'End': moveTo(maxX, state.y); break;
      default: handled = false;
    }
    if (handled) event.preventDefault();
  }

  function onKeyDown(event) {
    if (destroyed || event.key !== 'Escape' || !root.contains(event.target)) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCancel?.();
    }
  }

  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerup', onPointerUp);
  stage.addEventListener('pointercancel', onPointerUp);
  box.addEventListener('keydown', onBoxKeyDown);

  const onResize = () => layout();
  const view = documentRef.defaultView;
  view?.addEventListener?.('resize', onResize);
  if (image.complete) {
    layout();
  } else {
    image.addEventListener('load', layout, { once: true });
  }

  const root = documentRef.createElement('div');
  root.append(stage, anchorRow, actions);
  root.addEventListener('keydown', onKeyDown);
  layout();

  return {
    element: root,
    primaryButton: confirmButton,
    anchorButtons,
    getRect: () => ({ normalized: normalizedRect(), pixel: pixelRect() }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stage.removeEventListener('pointerdown', onPointerDown);
      stage.removeEventListener('pointermove', onPointerMove);
      stage.removeEventListener('pointerup', onPointerUp);
      stage.removeEventListener('pointercancel', onPointerUp);
      box.removeEventListener('keydown', onBoxKeyDown);
      root.removeEventListener('keydown', onKeyDown);
      view?.removeEventListener?.('resize', onResize);
    }
  };
}
