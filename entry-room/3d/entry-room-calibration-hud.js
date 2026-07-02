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
      </div>
      <div class="calibration-actions">
        <button type="button" data-ring-action="replay">Replay Ring</button>
        <button type="button" data-ring-action="show">Show Settled</button>
        <button type="button" data-ring-action="hide">Hide Ring</button>
      </div>
      <div class="calibration-actions">
        <button type="button" data-lock-action="preview">Settled Overlay View</button>
        <button type="button" data-lock-action="clear-preview">Clear Overlay View</button>
        <button type="button" data-lock-action="preview-final-grid">Preview Door Vacuum</button>
      </div>
      <div class="calibration-actions">
        <button type="button" data-floor-action="toggle">Show Floor</button>
        <button type="button" data-floor-action="edit">Edit Floor</button>
        <button type="button" data-floor-action="reset-active">Reset Floor</button>
      </div>
      <div class="calibration-controls">
        <h3>Shape stream</h3>
        <label>Min size <input type="number" min="0.05" max="0.8" step="0.01" value="0.30" data-stream-control="min-size"></label>
        <label>Max size <input type="number" min="0.05" max="0.8" step="0.01" value="0.30" data-stream-control="max-size"></label>
        <label>Color 1 <input type="color" value="#d01006" data-stream-color="0"></label>
        <label>Color 2 <input type="color" value="#f06c00" data-stream-color="1"></label>
        <label>Color 3 <input type="color" value="#ffbb00" data-stream-color="2"></label>
        <label>Color 4 <input type="color" value="#008a22" data-stream-color="3"></label>
        <label>Color 5 <input type="color" value="#00ced1" data-stream-color="4"></label>
        <label>Color 6 <input type="color" value="#006eff" data-stream-color="5"></label>
        <label>Color 7 <input type="color" value="#cb5cff" data-stream-color="6"></label>
        <label>Color 8 <input type="color" value="#ffcb70" data-stream-color="7"></label>
        <label>Color 9 <input type="color" value="#814812" data-stream-color="8"></label>
        <label>Color 10 <input type="color" value="#fff1e0" data-stream-color="9"></label>
        <h3>Floor editor - active layout</h3>
        <label>Front left X <input type="number" min="-0.5" max="1.5" step="0.001" data-floor-control="frontLeft.x"></label>
        <label>Front left Y <input type="number" min="-0.5" max="1.5" step="0.001" data-floor-control="frontLeft.y"></label>
        <label>Front right X <input type="number" min="-0.5" max="1.5" step="0.001" data-floor-control="frontRight.x"></label>
        <label>Front right Y <input type="number" min="-0.5" max="1.5" step="0.001" data-floor-control="frontRight.y"></label>
        <label>Back left X <input type="number" min="-0.5" max="1.5" step="0.001" data-floor-control="backLeft.x"></label>
        <label>Back left Y <input type="number" min="-0.5" max="1.5" step="0.001" data-floor-control="backLeft.y"></label>
        <label>Left corner X <input type="number" min="-0.5" max="1.5" step="0.001" data-floor-control="leftCorner.x"></label>
        <label>Left corner Y <input type="number" min="-0.5" max="1.5" step="0.001" data-floor-control="leftCorner.y"></label>
        <label>Back right X <input type="number" min="-0.5" max="1.5" step="0.001" data-floor-control="backRight.x"></label>
        <label>Back right Y <input type="number" min="-0.5" max="1.5" step="0.001" data-floor-control="backRight.y"></label>
        <label>Apex X <input type="number" min="-0.5" max="1.5" step="0.001" data-floor-control="apex.x"></label>
        <label>Apex Y <input type="number" min="-0.5" max="1.5" step="0.001" data-floor-control="apex.y"></label>
        <label>Z back <input type="number" min="-2" max="4" step="0.01" data-floor-control="zBack"></label>
        <label>Z front <input type="number" min="-2" max="4" step="0.01" data-floor-control="zFront"></label>
        <h3>Landing zones - active floor</h3>
        <label>Back center W <input type="number" min="0" max="1" step="0.001" data-phase-control="1.widthT"></label>
        <label>Back center D <input type="number" min="0" max="1" step="0.001" data-phase-control="1.depthT"></label>
        <label>Back center W spread <input type="number" min="0.02" max="0.8" step="0.01" data-phase-control="1.widthSpread"></label>
        <label>Back center D spread <input type="number" min="0.02" max="0.8" step="0.01" data-phase-control="1.depthSpread"></label>
        <label>Front fill W <input type="number" min="0" max="1" step="0.001" data-phase-control="2.widthT"></label>
        <label>Front fill D <input type="number" min="0" max="1" step="0.001" data-phase-control="2.depthT"></label>
        <label>Front fill W spread <input type="number" min="0.02" max="0.8" step="0.01" data-phase-control="2.widthSpread"></label>
        <label>Front fill D spread <input type="number" min="0.02" max="0.8" step="0.01" data-phase-control="2.depthSpread"></label>
        <label>Center W <input type="number" min="0" max="1" step="0.001" data-phase-control="3.widthT"></label>
        <label>Center D <input type="number" min="0" max="1" step="0.001" data-phase-control="3.depthT"></label>
        <label>Center W spread <input type="number" min="0.02" max="0.8" step="0.01" data-phase-control="3.widthSpread"></label>
        <label>Center D spread <input type="number" min="0.02" max="0.8" step="0.01" data-phase-control="3.depthSpread"></label>
        <label>Front right W <input type="number" min="0" max="1" step="0.001" data-phase-control="4.widthT"></label>
        <label>Front right D <input type="number" min="0" max="1" step="0.001" data-phase-control="4.depthT"></label>
        <label>Front right W spread <input type="number" min="0.02" max="0.8" step="0.01" data-phase-control="4.widthSpread"></label>
        <label>Front right D spread <input type="number" min="0.02" max="0.8" step="0.01" data-phase-control="4.depthSpread"></label>
        <label>Back right W <input type="number" min="0" max="1" step="0.001" data-phase-control="5.widthT"></label>
        <label>Back right D <input type="number" min="0" max="1" step="0.001" data-phase-control="5.depthT"></label>
        <label>Back right W spread <input type="number" min="0.02" max="0.8" step="0.01" data-phase-control="5.widthSpread"></label>
        <label>Back right D spread <input type="number" min="0.02" max="0.8" step="0.01" data-phase-control="5.depthSpread"></label>
        <label>Left W <input type="number" min="0" max="1" step="0.001" data-phase-control="6.widthT"></label>
        <label>Left D <input type="number" min="0" max="1" step="0.001" data-phase-control="6.depthT"></label>
        <label>Left W spread <input type="number" min="0.02" max="0.8" step="0.01" data-phase-control="6.widthSpread"></label>
        <label>Left D spread <input type="number" min="0.02" max="0.8" step="0.01" data-phase-control="6.depthSpread"></label>
        <label>Right W <input type="number" min="0" max="1" step="0.001" data-phase-control="7.widthT"></label>
        <label>Right D <input type="number" min="0" max="1" step="0.001" data-phase-control="7.depthT"></label>
        <label>Right W spread <input type="number" min="0.02" max="0.8" step="0.01" data-phase-control="7.widthSpread"></label>
        <label>Right D spread <input type="number" min="0.02" max="0.8" step="0.01" data-phase-control="7.depthSpread"></label>
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
