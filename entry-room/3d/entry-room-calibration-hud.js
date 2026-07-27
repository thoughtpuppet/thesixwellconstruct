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
        <label class="calibration-color-label">Color 1 <span class="calibration-color-control"><input type="color" value="#d01006" aria-label="Color 1 picker" data-stream-color="0"><input type="text" value="#d01006" aria-label="Color 1 hex" data-stream-color="0" data-color-hex maxlength="7" pattern="#?[0-9a-fA-F]{6}" autocomplete="off" autocapitalize="off" spellcheck="false"></span></label>
        <label class="calibration-color-label">Color 2 <span class="calibration-color-control"><input type="color" value="#f06c00" aria-label="Color 2 picker" data-stream-color="1"><input type="text" value="#f06c00" aria-label="Color 2 hex" data-stream-color="1" data-color-hex maxlength="7" pattern="#?[0-9a-fA-F]{6}" autocomplete="off" autocapitalize="off" spellcheck="false"></span></label>
        <label class="calibration-color-label">Color 3 <span class="calibration-color-control"><input type="color" value="#ffbb00" aria-label="Color 3 picker" data-stream-color="2"><input type="text" value="#ffbb00" aria-label="Color 3 hex" data-stream-color="2" data-color-hex maxlength="7" pattern="#?[0-9a-fA-F]{6}" autocomplete="off" autocapitalize="off" spellcheck="false"></span></label>
        <label class="calibration-color-label">Color 4 <span class="calibration-color-control"><input type="color" value="#008a22" aria-label="Color 4 picker" data-stream-color="3"><input type="text" value="#008a22" aria-label="Color 4 hex" data-stream-color="3" data-color-hex maxlength="7" pattern="#?[0-9a-fA-F]{6}" autocomplete="off" autocapitalize="off" spellcheck="false"></span></label>
        <label class="calibration-color-label">Color 5 <span class="calibration-color-control"><input type="color" value="#00ced1" aria-label="Color 5 picker" data-stream-color="4"><input type="text" value="#00ced1" aria-label="Color 5 hex" data-stream-color="4" data-color-hex maxlength="7" pattern="#?[0-9a-fA-F]{6}" autocomplete="off" autocapitalize="off" spellcheck="false"></span></label>
        <label class="calibration-color-label">Color 6 <span class="calibration-color-control"><input type="color" value="#006eff" aria-label="Color 6 picker" data-stream-color="5"><input type="text" value="#006eff" aria-label="Color 6 hex" data-stream-color="5" data-color-hex maxlength="7" pattern="#?[0-9a-fA-F]{6}" autocomplete="off" autocapitalize="off" spellcheck="false"></span></label>
        <label class="calibration-color-label">Color 7 <span class="calibration-color-control"><input type="color" value="#cb5cff" aria-label="Color 7 picker" data-stream-color="6"><input type="text" value="#cb5cff" aria-label="Color 7 hex" data-stream-color="6" data-color-hex maxlength="7" pattern="#?[0-9a-fA-F]{6}" autocomplete="off" autocapitalize="off" spellcheck="false"></span></label>
        <label class="calibration-color-label">Color 8 <span class="calibration-color-control"><input type="color" value="#ffcb70" aria-label="Color 8 picker" data-stream-color="7"><input type="text" value="#ffcb70" aria-label="Color 8 hex" data-stream-color="7" data-color-hex maxlength="7" pattern="#?[0-9a-fA-F]{6}" autocomplete="off" autocapitalize="off" spellcheck="false"></span></label>
        <label class="calibration-color-label">Color 9 <span class="calibration-color-control"><input type="color" value="#814812" aria-label="Color 9 picker" data-stream-color="8"><input type="text" value="#814812" aria-label="Color 9 hex" data-stream-color="8" data-color-hex maxlength="7" pattern="#?[0-9a-fA-F]{6}" autocomplete="off" autocapitalize="off" spellcheck="false"></span></label>
        <label class="calibration-color-label">Color 10 <span class="calibration-color-control"><input type="color" value="#fff1e0" aria-label="Color 10 picker" data-stream-color="9"><input type="text" value="#fff1e0" aria-label="Color 10 hex" data-stream-color="9" data-color-hex maxlength="7" pattern="#?[0-9a-fA-F]{6}" autocomplete="off" autocapitalize="off" spellcheck="false"></span></label>
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
        <label class="calibration-color-label">Door color <span class="calibration-color-control"><input type="color" value="#dc9b4c" aria-label="Door color picker" data-lock-control="door-color"><input type="text" value="#dc9b4c" aria-label="Door color hex" data-lock-control="door-color" data-color-hex maxlength="7" pattern="#?[0-9a-fA-F]{6}" autocomplete="off" autocapitalize="off" spellcheck="false"></span></label>
        <label class="calibration-color-label">Overlay color <span class="calibration-color-control"><input type="color" value="#eea449" aria-label="Door overlay color picker" data-lock-control="overlay-color"><input type="text" value="#eea449" aria-label="Door overlay color hex" data-lock-control="overlay-color" data-color-hex maxlength="7" pattern="#?[0-9a-fA-F]{6}" autocomplete="off" autocapitalize="off" spellcheck="false"></span></label>
        <label>Overlay opacity <input type="number" min="0" max="1" step="0.05" value="0.35" data-lock-control="overlay-opacity"></label>
        <label>Cycle min s <input type="number" min="0.2" max="10" step="0.1" value="3.0" data-lock-control="cycle-min"></label>
        <label>Cycle max s <input type="number" min="0.2" max="10" step="0.1" value="3.0" data-lock-control="cycle-max"></label>
        <label>Fade s <input type="number" min="0.05" max="4" step="0.05" value="0.36" data-lock-control="fade-time"></label>
        <h3>Door shape barrier</h3>
        <label>Enabled <input type="checkbox" checked data-shape-barrier-control="enabled"></label>
        <label>Hard collider <input type="checkbox" checked data-shape-barrier-control="hard-collider"></label>
        <label>X offset <input type="number" min="-0.4" max="0.4" step="0.005" value="0" data-shape-barrier-control="screen-offset-x"></label>
        <label>Y offset <input type="number" min="-0.4" max="0.4" step="0.005" value="0.005" data-shape-barrier-control="screen-offset-y"></label>
        <label>Side radius <input type="number" min="0.005" max="0.25" step="0.005" value="0.035" data-shape-barrier-control="screen-half-width"></label>
        <label>Top pad <input type="number" min="0" max="0.6" step="0.01" value="0.040" data-shape-barrier-control="screen-top-pad"></label>
        <label>Bottom pad <input type="number" min="0" max="0.8" step="0.01" value="0.050" data-shape-barrier-control="screen-bottom-pad"></label>
        <label>Target penalty <input type="number" min="0" max="40" step="0.5" value="17.5" data-shape-barrier-control="screen-target-penalty"></label>
        <label>Push strength <input type="number" min="0" max="30" step="0.5" value="17" data-shape-barrier-control="screen-deflect-strength"></label>
        <label>Max push speed <input type="number" min="0" max="20" step="0.25" value="8" data-shape-barrier-control="screen-deflect-max-speed"></label>
        <h3>Door eye exit</h3>
        <div class="calibration-actions">
          <button type="button" data-eye-action="preview-open">Show Open Eye</button>
          <button type="button" data-eye-action="preview-closed">Show Closed Eye</button>
          <button type="button" data-eye-action="preview-blink">Preview Blink</button>
          <button type="button" data-eye-action="preview-transition">Preview Break Transition</button>
          <button type="button" data-eye-action="hide">Hide Eye</button>
        </div>
        <label class="calibration-color-label">Eye color <span class="calibration-color-control"><input type="color" value="#fcb867" aria-label="Eye color picker" data-eye-control="eye-color"><input type="text" value="#fcb867" aria-label="Eye color hex" data-eye-control="eye-color" data-color-hex maxlength="7" pattern="#?[0-9a-fA-F]{6}" autocomplete="off" autocapitalize="off" spellcheck="false"></span></label>
        <label>Eye opacity <input type="number" min="0" max="1" step="0.05" value="1" data-eye-control="eye-opacity"></label>
        <label class="calibration-color-label">Overlay color <span class="calibration-color-control"><input type="color" value="#000000" aria-label="Eye overlay color picker" data-eye-control="overlay-color"><input type="text" value="#000000" aria-label="Eye overlay color hex" data-eye-control="overlay-color" data-color-hex maxlength="7" pattern="#?[0-9a-fA-F]{6}" autocomplete="off" autocapitalize="off" spellcheck="false"></span></label>
        <label>Overlay opacity <input type="number" min="0" max="1" step="0.05" value="0.48" data-eye-control="overlay-opacity"></label>
        <label>Closed fade s <input type="number" min="0.05" max="4" step="0.05" value="0.58" data-eye-control="closed-reveal-duration"></label>
        <label>Open fade s <input type="number" min="0.05" max="4" step="0.05" value="0.42" data-eye-control="open-reveal-duration"></label>
        <label>Blink count <input type="number" min="1" max="16" step="1" value="6" data-eye-control="blink-count"></label>
        <label>Blink duration s <input type="number" min="0.04" max="1.5" step="0.01" value="0.22" data-eye-control="blink-duration"></label>
        <label>Break fade s <input type="number" min="0" max="3" step="0.01" value="2.00" data-eye-control="break-handoff-duration"></label>
        <label>Site fade s <input type="number" min="0.05" max="3" step="0.01" value="0.37" data-eye-control="site-fade-duration"></label>
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
