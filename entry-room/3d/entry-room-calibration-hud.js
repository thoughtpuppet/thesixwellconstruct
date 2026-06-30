export function mountCalibrationHud(root = document.body) {
  if (!root || document.getElementById('calibration-console')) {
    return document.getElementById('calibration-console');
  }

  const wrapper = document.createElement('section');
  wrapper.id = 'calibration-console';
  wrapper.setAttribute('aria-label', 'Calibration console');
  wrapper.innerHTML = `
    <div class="calibration-head">
      <h2>Calibration Console</h2>
      <button type="button" id="cal-toggle" aria-expanded="true">_</button>
    </div>
    <div id="cal-body">
      <div class="calibration-actions">
        <button type="button" data-cal-copy="active">Copy Active</button>
        <button type="button" data-cal-copy="all">Copy All</button>
        <button type="button" data-feedback-toggle>Feedback</button>
      </div>
      <div class="calibration-actions">
        <button type="button" data-ring-action="replay">Replay Ring</button>
        <button type="button" data-ring-action="show">Show Settled</button>
        <button type="button" data-ring-action="hide">Hide Ring</button>
      </div>
      <div class="calibration-actions">
        <button type="button" data-lock-action="preview">Settled Overlay View</button>
        <button type="button" data-lock-action="clear-preview">Clear Overlay View</button>
      </div>
      <div class="calibration-controls">
        <h3>Door channel</h3>
        <label>Door color <input type="color" value="#dc9b4c" data-lock-control="door-color"></label>
        <label>Overlay color <input type="color" value="#eea449" data-lock-control="overlay-color"></label>
        <label>Overlay opacity <input type="number" min="0" max="1" step="0.05" value="0.35" data-lock-control="overlay-opacity"></label>
        <label>Cycle min s <input type="number" min="0.2" max="10" step="0.1" value="3.0" data-lock-control="cycle-min"></label>
        <label>Cycle max s <input type="number" min="0.2" max="10" step="0.1" value="3.0" data-lock-control="cycle-max"></label>
        <label>Fade s <input type="number" min="0.05" max="4" step="0.05" value="0.36" data-lock-control="fade-time"></label>
        <h3>Door position - active layout</h3>
        <label>X <input type="number" min="-0.5" max="1.5" step="0.001" data-lock-control="door-x"></label>
        <label>Y <input type="number" min="-0.5" max="1.5" step="0.001" data-lock-control="door-y"></label>
        <label class="control-wide">Size <input type="number" min="0.005" max="0.1" step="0.001" data-lock-control="door-size"></label>
        <h3>Live layout dump</h3>
        <output id="calibration-output" aria-live="polite"></output>
      </div>
    </div>
  `;

  root.appendChild(wrapper);
  return wrapper;
}
