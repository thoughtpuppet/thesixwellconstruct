/* Shared Six.Well single-choice select enhancement. */
(function (global) {
  "use strict";

  if (global.SixWellSelectMenu) return;

  const instances = new WeakMap();
  const liveInstances = new Set();
  const selector = 'select:not([multiple]):not([size]):not([data-select-menu-skip])';
  let openInstance = null;
  let sequence = 0;
  let observer = null;
  let resizeFrame = 0;

  function isSelect(value) {
    return value instanceof global.HTMLSelectElement;
  }

  function isEligible(select) {
    return isSelect(select)
      && !select.multiple
      && (!select.hasAttribute("size") || Number(select.getAttribute("size")) <= 1)
      && !select.hasAttribute("data-select-menu-skip");
  }

  function labelText(select) {
    const ariaLabel = select.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel.trim();
    const label = select.labels?.[0];
    if (!label) return select.name || "Select an option";
    const clone = label.cloneNode(true);
    clone.querySelectorAll("select,input,textarea,button,.custom-select").forEach((node) => node.remove());
    return clone.textContent.replace(/\s+/g, " ").trim() || select.name || "Select an option";
  }

  function enabledIndexes(instance) {
    return instance.options
      .map((option, index) => ({ option, index }))
      .filter(({ option }) => !option.disabled && !option.hidden)
      .map(({ index }) => index);
  }

  function selectedEnabledIndex(instance) {
    const selected = instance.select.selectedIndex;
    if (selected >= 0 && !instance.options[selected]?.disabled && !instance.options[selected]?.hidden) return selected;
    return enabledIndexes(instance)[0] ?? -1;
  }

  function updateActive(instance, index, shouldScroll) {
    const available = enabledIndexes(instance);
    if (!available.length) index = -1;
    else if (!available.includes(index)) index = available[0];
    instance.activeIndex = index;
    instance.items.forEach((item, itemIndex) => {
      const active = itemIndex === index;
      item.classList.toggle("is-active-option", active);
      if (active) instance.trigger.setAttribute("aria-activedescendant", item.id);
    });
    if (index < 0) instance.trigger.removeAttribute("aria-activedescendant");
    if (shouldScroll && index >= 0) instance.items[index]?.scrollIntoView({ block: "nearest" });
  }

  function syncVisibility(instance) {
    if (!instance.select.isConnected) return;
    const hiddenByOwnStyle = global.getComputedStyle(instance.select).display === "none";
    instance.root.hidden = instance.select.hidden || hiddenByOwnStyle;
    if (instance.root.hidden && instance === openInstance) close(instance, false);
  }

  function positionList(instance) {
    if (!instance.root.classList.contains("open") || !instance.root.isConnected) return;
    const rect = instance.root.getBoundingClientRect();
    const below = Math.max(0, global.innerHeight - rect.bottom - 12);
    const above = Math.max(0, rect.top - 12);
    const desired = Math.min(240, Math.max(96, instance.list.scrollHeight));
    const opensUp = below < desired && above > below;
    const available = Math.max(96, Math.min(240, opensUp ? above : below));
    instance.root.classList.toggle("opens-up", opensUp);
    instance.root.style.setProperty("--select-menu-list-max-height", `${available}px`);
  }

  function close(instance, restoreFocus) {
    if (!instance) return;
    instance.root.classList.remove("open", "opens-up");
    instance.trigger.setAttribute("aria-expanded", "false");
    instance.trigger.removeAttribute("aria-activedescendant");
    instance.typeBuffer = "";
    if (openInstance === instance) openInstance = null;
    if (restoreFocus && instance.trigger.isConnected) instance.trigger.focus({ preventScroll: true });
  }

  function closeAll(options = {}) {
    const restoreFocus = options.restoreFocus === true;
    for (const instance of [...liveInstances]) {
      if (!instance.select.isConnected && !instance.root.isConnected) {
        liveInstances.delete(instance);
        continue;
      }
      if (instance.root.classList.contains("open")) close(instance, restoreFocus);
    }
  }

  function open(instance) {
    if (instance.select.disabled || !instance.options.length || instance.root.hidden) return;
    if (openInstance && openInstance !== instance) close(openInstance, false);
    instance.root.classList.add("open");
    instance.trigger.setAttribute("aria-expanded", "true");
    openInstance = instance;
    updateActive(instance, selectedEnabledIndex(instance), false);
    positionList(instance);
    updateActive(instance, instance.activeIndex, true);
  }

  function move(instance, direction) {
    const available = enabledIndexes(instance);
    if (!available.length) return;
    let position = available.indexOf(instance.activeIndex);
    if (position < 0) position = 0;
    position = (position + direction + available.length) % available.length;
    updateActive(instance, available[position], true);
  }

  function moveToEdge(instance, edge) {
    const available = enabledIndexes(instance);
    if (!available.length) return;
    updateActive(instance, edge === "start" ? available[0] : available[available.length - 1], true);
  }

  function dispatchSelection(instance, index) {
    const option = instance.options[index];
    if (!option || option.disabled || option.hidden) return;
    const changed = instance.select.selectedIndex !== index;
    instance.select.selectedIndex = index;
    instance.root.classList.remove("is-invalid");
    instance.trigger.removeAttribute("aria-invalid");
    sync(instance.select);
    close(instance, true);
    if (!changed) return;
    instance.select.dispatchEvent(new Event("input", { bubbles: true }));
    instance.select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function runTypeahead(instance, key) {
    const now = Date.now();
    if (now - instance.typeAt > 700) instance.typeBuffer = "";
    instance.typeAt = now;
    instance.typeBuffer += key.toLocaleLowerCase();
    const available = enabledIndexes(instance);
    if (!available.length) return;
    const currentPosition = Math.max(-1, available.indexOf(instance.activeIndex));
    const ordered = available.slice(currentPosition + 1).concat(available.slice(0, currentPosition + 1));
    let match = ordered.find((index) => instance.options[index].textContent.trim().toLocaleLowerCase().startsWith(instance.typeBuffer));
    if (match === undefined && instance.typeBuffer.length > 1) {
      instance.typeBuffer = key.toLocaleLowerCase();
      match = ordered.find((index) => instance.options[index].textContent.trim().toLocaleLowerCase().startsWith(instance.typeBuffer));
    }
    if (match !== undefined) updateActive(instance, match, true);
  }

  function handleKeydown(instance, event) {
    const isOpen = instance.root.classList.contains("open");
    if (event.key === "Tab") {
      if (isOpen) close(instance, false);
      return;
    }
    if (event.key === "Escape") {
      if (isOpen) {
        event.preventDefault();
        close(instance, true);
      }
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!isOpen) open(instance);
      else dispatchSelection(instance, instance.activeIndex);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) open(instance);
      else move(instance, event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (!isOpen) open(instance);
      moveToEdge(instance, event.key === "Home" ? "start" : "end");
      return;
    }
    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      if (!isOpen) open(instance);
      runTypeahead(instance, event.key);
    }
  }

  function sync(select) {
    const instance = instances.get(select);
    if (!instance) return enhance(select);
    instance.options = [...select.options];
    instance.list.replaceChildren();
    instance.items = instance.options.map((option, index) => {
      const item = document.createElement("li");
      item.id = `${instance.id}-option-${index}`;
      item.className = "custom-select-option";
      item.dataset.index = String(index);
      item.textContent = option.textContent;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(index === select.selectedIndex));
      item.setAttribute("aria-disabled", String(option.disabled));
      item.hidden = option.hidden;
      item.classList.toggle("is-selected", index === select.selectedIndex);
      item.classList.toggle("is-disabled", option.disabled);
      instance.list.appendChild(item);
      return item;
    });

    const selected = instance.options[select.selectedIndex];
    instance.value.textContent = selected?.textContent || "";
    instance.trigger.setAttribute("aria-label", labelText(select));
    const describedBy = select.getAttribute("aria-describedby");
    if (describedBy) instance.trigger.setAttribute("aria-describedby", describedBy);
    else instance.trigger.removeAttribute("aria-describedby");
    const disabled = select.disabled || instance.options.length === 0;
    instance.trigger.disabled = disabled;
    instance.trigger.setAttribute("aria-disabled", String(disabled));
    instance.trigger.setAttribute("aria-required", String(select.required));
    instance.root.classList.toggle("is-disabled", disabled);
    instance.root.classList.toggle("is-active", select.classList.contains("is-active"));
    if (!instance.root.classList.contains("open")) instance.activeIndex = selectedEnabledIndex(instance);
    else updateActive(instance, instance.activeIndex, false);
    syncVisibility(instance);
    if (disabled && instance === openInstance) close(instance, false);
    return instance;
  }

  function bindLabels(instance) {
    [...(instance.select.labels || [])].forEach((label) => {
      label.addEventListener("click", (event) => {
        if (instance.root.contains(event.target)) return;
        if (event.target.closest("a,button,input,textarea,[contenteditable='true']")) return;
        event.preventDefault();
        instance.trigger.focus({ preventScroll: true });
        open(instance);
      });
    });
  }

  function enhanceSelect(select) {
    if (!isEligible(select)) return null;
    if (instances.has(select)) return sync(select);
    if (select.dataset.enhanced && select.nextElementSibling?.matches(".custom-select[data-sixwell-select]")) return null;

    sequence += 1;
    const id = `sixwell-select-${sequence}`;
    const root = document.createElement("div");
    root.className = "custom-select";
    root.dataset.sixwellSelect = "1";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "custom-select-trigger";
    trigger.id = `${id}-trigger`;
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", `${id}-list`);
    const value = document.createElement("span");
    value.className = "custom-select-value";
    const arrow = document.createElement("span");
    arrow.className = "custom-select-arrow";
    arrow.setAttribute("aria-hidden", "true");
    trigger.append(value, arrow);
    const list = document.createElement("ul");
    list.className = "custom-select-list";
    list.id = `${id}-list`;
    list.setAttribute("role", "listbox");
    root.append(trigger, list);
    select.insertAdjacentElement("afterend", root);

    const originalTabIndex = select.getAttribute("tabindex");
    select.dataset.enhanced = "1";
    select.dataset.selectMenuOriginalTabindex = originalTabIndex ?? "";
    select.classList.add("native-select-hidden");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");

    const instance = {
      id,
      select,
      root,
      trigger,
      value,
      list,
      options: [],
      items: [],
      activeIndex: -1,
      typeBuffer: "",
      typeAt: 0,
    };
    instances.set(select, instance);
    liveInstances.add(instance);
    select._customSync = () => sync(select);

    trigger.addEventListener("click", () => {
      if (root.classList.contains("open")) close(instance, false);
      else open(instance);
    });
    trigger.addEventListener("keydown", (event) => handleKeydown(instance, event));
    list.addEventListener("pointermove", (event) => {
      const item = event.target.closest(".custom-select-option");
      if (!item || item.classList.contains("is-disabled")) return;
      updateActive(instance, Number(item.dataset.index), false);
    });
    list.addEventListener("click", (event) => {
      const item = event.target.closest(".custom-select-option");
      if (!item) return;
      dispatchSelection(instance, Number(item.dataset.index));
    });
    select.addEventListener("input", () => sync(select));
    select.addEventListener("change", () => sync(select));
    select.addEventListener("invalid", () => {
      root.classList.add("is-invalid");
      trigger.setAttribute("aria-invalid", "true");
      close(instance, false);
      global.requestAnimationFrame(() => trigger.focus({ preventScroll: true }));
    });
    bindLabels(instance);
    return sync(select);
  }

  function enhance(root = document) {
    if (isSelect(root)) return enhanceSelect(root);
    const scope = root?.querySelectorAll ? root : document;
    const selects = [];
    if (scope.matches?.(selector)) selects.push(scope);
    selects.push(...scope.querySelectorAll(selector));
    return selects.map(enhanceSelect).filter(Boolean);
  }

  function cleanupRemoved(node) {
    if (!(node instanceof Element)) return;
    const selects = [];
    if (isSelect(node)) selects.push(node);
    selects.push(...node.querySelectorAll("select"));
    selects.forEach((select) => {
      const instance = instances.get(select);
      if (!instance) return;
      if (openInstance === instance) openInstance = null;
      if (instance.root.isConnected) instance.root.remove();
      liveInstances.delete(instance);
      instances.delete(select);
    });
  }

  function startObserver() {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver((records) => {
      const selectsToSync = new Set();
      records.forEach((record) => {
        if (record.type === "childList") {
          record.addedNodes.forEach((node) => {
            if (!(node instanceof Element)) return;
            if (isSelect(node)) enhanceSelect(node);
            enhance(node);
          });
          record.removedNodes.forEach(cleanupRemoved);
        }
        const targetSelect = isSelect(record.target) ? record.target : record.target.closest?.("select");
        if (targetSelect && instances.has(targetSelect)) selectsToSync.add(targetSelect);
      });
      selectsToSync.forEach(sync);
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["disabled", "required", "hidden", "class", "label", "selected", "value", "aria-label", "aria-describedby"],
    });
  }

  function refreshLayout() {
    if (resizeFrame) return;
    resizeFrame = global.requestAnimationFrame(() => {
      resizeFrame = 0;
      for (const instance of [...liveInstances]) {
        if (!instance.select.isConnected) {
          liveInstances.delete(instance);
          continue;
        }
        syncVisibility(instance);
      }
      if (openInstance) positionList(openInstance);
    });
  }

  document.addEventListener("pointerdown", (event) => {
    if (openInstance && !openInstance.root.contains(event.target)) close(openInstance, false);
  }, true);
  document.addEventListener("reset", (event) => {
    global.setTimeout(() => enhance(event.target), 0);
  }, true);
  global.addEventListener("resize", refreshLayout);
  global.addEventListener("orientationchange", refreshLayout);
  document.addEventListener("scroll", () => {
    if (openInstance) positionList(openInstance);
  }, true);

  global.SixWellSelectMenu = { enhance, sync, closeAll };
  startObserver();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => enhance(document), { once: true });
  else enhance(document);
  document.dispatchEvent(new CustomEvent("sixwell:select-menu-ready"));
})(window);
