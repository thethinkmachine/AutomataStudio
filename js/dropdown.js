// ══════════════════════════════════════════════════════════════════
//  CUSTOM SELECT
// ══════════════════════════════════════════════════════════════════
// Native selects remain the source of truth for existing application logic.
// This layer supplies a consistent, themeable popup and mirrors changes both
// ways, including selects inserted dynamically into modal content.

export const CustomSelects = new WeakMap();
export let OpenCustomSelect = null;
export let customSelectUid = 0;

export function customSelectLabel(select) {
  return select.getAttribute('aria-label')
    || select.getAttribute('label')
    || select.closest('label')?.querySelector('span')?.textContent?.trim()
    || select.closest('.modal-row')?.querySelector('.modal-lbl')?.textContent?.trim()
    || select.id
    || 'Select option';
}

export function customSelectOptions(select) {
  return Array.from(select.children).flatMap(child => {
    if (child.tagName === 'OPTGROUP') {
      return [
        { group: true, label: child.label },
        ...Array.from(child.children).map(option => ({ option, groupDisabled: child.disabled }))
      ];
    }
    return child.tagName === 'OPTION' ? [{ option: child, groupDisabled: false }] : [];
  });
}

export function syncCustomSelect(select) {
  const api = CustomSelects.get(select);
  if (!api) return;
  const option = select.selectedOptions?.[0] || select.options?.[select.selectedIndex] || null;
  api.value.textContent = option ? option.textContent : '';
  api.trigger.title = option ? option.textContent : '';
  api.trigger.disabled = select.disabled;
  api.wrapper.classList.toggle('disabled', select.disabled);
  api.renderOptions();
}

export function closeCustomSelect({ focus = false } = {}) {
  if (!OpenCustomSelect) return;
  const api = OpenCustomSelect;
  OpenCustomSelect = null;
  api.wrapper.classList.remove('open');
  api.listbox.classList.remove('open');
  api.trigger.setAttribute('aria-expanded', 'false');
  api.trigger.removeAttribute('aria-activedescendant');
  if (focus && document.contains(api.trigger)) api.trigger.focus();
}

export function positionCustomSelect(api) {
  const rect = api.trigger.getBoundingClientRect();
  const gap = 5;
  const viewportGap = 8;
  const width = Math.max(rect.width, Math.min(360, api.listbox.scrollWidth || rect.width));
  const roomBelow = window.innerHeight - rect.bottom - viewportGap;
  const roomAbove = rect.top - viewportGap;
  const openAbove = roomBelow < Math.min(220, api.listbox.scrollHeight) && roomAbove > roomBelow;

  api.listbox.style.width = `${Math.min(width, window.innerWidth - viewportGap * 2)}px`;
  api.listbox.style.left = `${Math.max(viewportGap, Math.min(rect.left, window.innerWidth - width - viewportGap))}px`;
  if (openAbove) {
    api.listbox.style.top = 'auto';
    api.listbox.style.bottom = `${window.innerHeight - rect.top + gap}px`;
    api.listbox.style.maxHeight = `${Math.max(90, roomAbove - gap)}px`;
  } else {
    api.listbox.style.top = `${rect.bottom + gap}px`;
    api.listbox.style.bottom = 'auto';
    api.listbox.style.maxHeight = `${Math.max(90, roomBelow - gap)}px`;
  }
}

export function setCustomSelectActive(api, index, scroll = true) {
  const options = Array.from(api.listbox.querySelectorAll('.custom-select-option:not([aria-disabled="true"])'));
  if (!options.length) return;
  const bounded = (index + options.length) % options.length;
  options.forEach((option, optionIndex) => option.classList.toggle('active', optionIndex === bounded));
  api.activeIndex = bounded;
  api.trigger.setAttribute('aria-activedescendant', options[bounded].id);
  if (scroll) options[bounded].scrollIntoView({ block: 'nearest' });
}

export function moveCustomSelectActive(api, delta) {
  const options = Array.from(api.listbox.querySelectorAll('.custom-select-option:not([aria-disabled="true"])'));
  if (!options.length) return;
  const current = api.activeIndex >= 0
    ? api.activeIndex
    : Math.max(0, options.findIndex(option => option.getAttribute('aria-selected') === 'true'));
  setCustomSelectActive(api, current + delta);
}

export function chooseCustomSelectOption(api, option) {
  if (!option || option.disabled || option.parentElement?.disabled) return;
  api.select.value = option.value;
  api.select.dispatchEvent(new Event('input', { bubbles: true }));
  api.select.dispatchEvent(new Event('change', { bubbles: true }));
  syncCustomSelect(api.select);
  closeCustomSelect({ focus: true });
}

export function openCustomSelect(api) {
  if (api.select.disabled) return;
  if (OpenCustomSelect === api) {
    closeCustomSelect({ focus: true });
    return;
  }
  closeCustomSelect();
  api.renderOptions();
  OpenCustomSelect = api;
  api.wrapper.classList.add('open');
  api.listbox.classList.add('open');
  api.trigger.setAttribute('aria-expanded', 'true');
  positionCustomSelect(api);
  const options = Array.from(api.listbox.querySelectorAll('.custom-select-option:not([aria-disabled="true"])'));
  const selectedIndex = options.findIndex(option => option.getAttribute('aria-selected') === 'true');
  setCustomSelectActive(api, Math.max(0, selectedIndex), false);
  options[Math.max(0, selectedIndex)]?.scrollIntoView({ block: 'nearest' });
}

export function enhanceCustomSelect(select) {
  if (!select || CustomSelects.has(select) || select.dataset.nativeSelect !== undefined) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'custom-select';
  if (select.classList.contains('inp')) wrapper.classList.add('custom-select--inp');
  if (select.classList.contains('sel')) wrapper.classList.add('custom-select--sel');
  if (select.classList.contains('sim-speed-sel')) wrapper.classList.add('custom-select--sim-speed');
  ['flex', 'width', 'minWidth', 'maxWidth', 'height'].forEach(property => {
    if (select.style[property]) wrapper.style[property] = select.style[property];
  });

  const trigger = document.createElement('button');
  const value = document.createElement('span');
  const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const listbox = document.createElement('div');
  const label = customSelectLabel(select);
  const listboxId = `custom-select-list-${++customSelectUid}`;

  trigger.type = 'button';
  trigger.className = 'custom-select-trigger';
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', listboxId);
  trigger.setAttribute('aria-label', label);
  if (select.dataset.tip) trigger.dataset.tip = select.dataset.tip;
  ['fontSize', 'fontFamily', 'fontWeight', 'padding', 'textAlign'].forEach(property => {
    if (select.style[property]) trigger.style[property] = select.style[property];
  });

  value.className = 'custom-select-value';
  chevron.classList.add('custom-select-chevron');
  chevron.setAttribute('viewBox', '0 0 12 12');
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = '<path d="M2.25 4.25 6 8l3.75-3.75" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';
  trigger.append(value, chevron);

  listbox.id = listboxId;
  listbox.className = 'custom-select-listbox';
  listbox.setAttribute('role', 'listbox');
  listbox.setAttribute('aria-label', label);

  select.parentNode.insertBefore(wrapper, select);
  wrapper.append(select, trigger);
  document.body.appendChild(listbox);
  select.classList.add('custom-select-native');
  select.setAttribute('tabindex', '-1');

  const api = {
    select,
    wrapper,
    trigger,
    value,
    listbox,
    activeIndex: -1,
    typeahead: '',
    typeaheadTimer: null,
    observer: null,
    renderOptions() {
      const fragment = document.createDocumentFragment();
      customSelectOptions(select).forEach((entry, sourceIndex) => {
        if (entry.group) {
          const group = document.createElement('div');
          group.className = 'custom-select-group';
          group.textContent = entry.label;
          fragment.appendChild(group);
          return;
        }
        const option = entry.option;
        const item = document.createElement('div');
        const disabled = option.disabled || entry.groupDisabled;
        item.id = `${listboxId}-option-${sourceIndex}`;
        item.className = 'custom-select-option';
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', option.selected ? 'true' : 'false');
        item.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        item.textContent = option.textContent;
        item.addEventListener('mousedown', event => event.preventDefault());
        item.addEventListener('click', () => chooseCustomSelectOption(api, option));
        fragment.appendChild(item);
      });
      listbox.replaceChildren(fragment);
    }
  };

  CustomSelects.set(select, api);
  trigger.addEventListener('click', () => openCustomSelect(api));
  trigger.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (OpenCustomSelect === api) {
        event.preventDefault();
        event.stopPropagation();
        closeCustomSelect({ focus: true });
      }
      return;
    }
    if (event.key === 'Tab') {
      closeCustomSelect();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (OpenCustomSelect !== api) openCustomSelect(api);
      else {
        const active = listbox.querySelector('.custom-select-option.active');
        active?.click();
      }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (OpenCustomSelect !== api) openCustomSelect(api);
      else moveCustomSelectActive(api, event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      if (OpenCustomSelect !== api) return;
      event.preventDefault();
      setCustomSelectActive(api, event.key === 'Home' ? 0 : -1);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      clearTimeout(api.typeaheadTimer);
      api.typeahead += event.key.toLowerCase();
      api.typeaheadTimer = setTimeout(() => { api.typeahead = ''; }, 500);
      if (OpenCustomSelect !== api) openCustomSelect(api);
      const options = Array.from(listbox.querySelectorAll('.custom-select-option:not([aria-disabled="true"])'));
      const match = options.findIndex(option => option.textContent.trim().toLowerCase().startsWith(api.typeahead));
      if (match !== -1) setCustomSelectActive(api, match);
    }
  });

  select.addEventListener('change', () => syncCustomSelect(select));
  select.addEventListener('input', () => syncCustomSelect(select));
  api.observer = new MutationObserver(() => syncCustomSelect(select));
  api.observer.observe(select, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true
  });

  const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  if (valueDescriptor?.configurable && valueDescriptor.get && valueDescriptor.set) {
    Object.defineProperty(select, 'value', {
      configurable: true,
      get() { return valueDescriptor.get.call(this); },
      set(next) {
        valueDescriptor.set.call(this, next);
        queueMicrotask(() => syncCustomSelect(this));
      }
    });
  }

  syncCustomSelect(select);
}

export function initCustomSelects(root = document) {
  if (root.matches?.('select')) enhanceCustomSelect(root);
  root.querySelectorAll?.('select').forEach(enhanceCustomSelect);
}

export function destroyCustomSelects(root) {
  const selects = [];
  if (root.matches?.('select')) selects.push(root);
  root.querySelectorAll?.('select').forEach(select => selects.push(select));
  selects.forEach(select => {
    if (select.isConnected) return;
    const api = CustomSelects.get(select);
    if (!api) return;
    if (OpenCustomSelect === api) closeCustomSelect();
    clearTimeout(api.typeaheadTimer);
    api.observer?.disconnect();
    api.listbox.remove();
    CustomSelects.delete(select);
  });
}

document.addEventListener('click', event => {
  if (!OpenCustomSelect) return;
  if (OpenCustomSelect.wrapper.contains(event.target) || OpenCustomSelect.listbox.contains(event.target)) return;
  closeCustomSelect();
});

window.addEventListener('resize', () => OpenCustomSelect && positionCustomSelect(OpenCustomSelect));
window.addEventListener('scroll', () => OpenCustomSelect && positionCustomSelect(OpenCustomSelect), true);

export const customSelectObserver = new MutationObserver(mutations => {
  mutations.forEach(mutation => {
    mutation.addedNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) initCustomSelects(node);
    });
    mutation.removedNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) destroyCustomSelects(node);
    });
  });
});

document.addEventListener('DOMContentLoaded', () => {
  initCustomSelects();
  customSelectObserver.observe(document.body, { childList: true, subtree: true });
});
