/**
 * @license
 * Code City: Code Explorer.
 *
 * Copyright 2018 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview Integrated Development Environment for Code City.
 * @author fraser@google.com (Neil Fraser)
 */

Code.Explorer = {};

/**
 * Width in pixels of each monospaced character in the input.
 * Used to line up the autocomplete menu.
 */
Code.Explorer.SIZE_OF_INPUT_CHARS = 10.8;

/**
 * Value of the input field last time it was processed.
 * @type {?string}
 */
Code.Explorer.oldInputValue = null;

/**
 * JSON-encoded list of complete object selector parts.
 * @type {string}
 */
Code.Explorer.oldInputPartsJSON = 'null';

/**
 * Final part which may not be complete and isn't included in the parts list.
 * E.g. '$.foo.bar' the 'bar' might become 'bart' or 'barf'.
 * @type {?Object}
 */
Code.Explorer.oldInputPartsLast = null;

/**
 * PID of task polling for changes to the input field.
 */
Code.Explorer.inputPollPid = 0;

/**
 * Raw string of selector.
 * E.g. '$.foo["bar"]'
 */
Code.Explorer.selector = '';

/**
 * Got a ping from someone.  Something might have changed and need updating.
 */
Code.Explorer.receiveMessage = function() {
  // Check to see if the stored values have changed.
  var selector = sessionStorage.getItem(Code.Common.SELECTOR);
  if (selector === Code.Explorer.selector) {
    return;
  }
  // Propagate the ping down the tree of frames.
  Code.Explorer.selector = selector;
  if (Code.Explorer.oldInputValue !== selector) {
    var parts = Code.Common.selectorToParts(selector);
    Code.Explorer.setInput(parts);
  }
};

/**
 * Handle any changes to the input field.
 */
Code.Explorer.inputChange = function() {
  var input = document.getElementById('input');
  if (Code.Explorer.oldInputValue === input.value) {
    return;
  }
  Code.Explorer.oldInputValue = input.value;
  var tokens = Code.Common.tokenizeSelector(input.value);
  var parts = [];
  var lastToken = null;
  var lastName = null;
  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i];
    lastToken = token;
    if (token.type === 'id' || token.type === '"' || token.type === '#') {
      lastName = token;
    }
    if (!token.valid) {
      break;
    }
    if ((token.type === '.' || token.type === '[' || token.type === ']') &&
        lastName) {
      parts.push(lastName.value);
      lastName = null;
    }
  }
  Code.Explorer.oldInputPartsLast = lastName;
  var partsJSON = JSON.stringify(parts);
  if (Code.Explorer.oldInputPartsJSON === partsJSON) {
    Code.Explorer.updateAutocompleteMenu(lastToken);
  } else {
    Code.Explorer.oldInputPartsJSON = partsJSON;
    Code.Explorer.sendAutocomplete(partsJSON);
    Code.Explorer.hideAutocompleteMenu();
    Code.Explorer.loadPanels(parts);
  }
};

/**
 * Send a request to Code City's autocomplete service.
 * @param {string} partsJSON Stringified array of parts to send to Code City.
 */
Code.Explorer.sendAutocomplete = function(partsJSON) {
  var xhr = Code.Explorer.sendAutocomplete.httpRequest_;
  xhr.abort();
  xhr.open('POST', '/code/autocomplete', true);
  xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  xhr.onreadystatechange = Code.Explorer.receiveAutocomplete;
  xhr.send('parts=' + encodeURIComponent(partsJSON));
  console.log('Sending to CC: ' + partsJSON);
};
Code.Explorer.sendAutocomplete.httpRequest_ = new XMLHttpRequest();

/**
 * Got a response from Code City's autocomplete service.
 */
Code.Explorer.receiveAutocomplete = function() {
  var xhr = Code.Explorer.sendAutocomplete.httpRequest_;
  if (xhr.readyState !== 4) {
    return;  // Not ready yet.
  }
  if (xhr.status !== 200) {
    console.warn('Autocomplete returned status ' + xhr.status);
    return;
  }
  var data = JSON.parse(xhr.responseText);
  Code.Explorer.filterShadowed(data);
  Code.Explorer.autocompleteData = data || [];
  // Trigger the input to show autocompletion.
  Code.Explorer.oldInputValue = null;
  Code.Explorer.inputChange();
};

/**
 * Given a partial prefix, filter the autocompletion menu and display
 * all matching options.
 * @param {!Object} token Last token in the parts list.
 */
Code.Explorer.updateAutocompleteMenu = function(token) {
  var prefix = '';
  var index = token ? token.index : 0;
  if (token) {
    if (token.type === 'id' || token.type === '"') {
      prefix = token.value.toLowerCase();
    }
    if ((token.type === '#') && !isNaN(token.value)) {
      prefix = String(token.value);
    }
    if (token.type === '.' || token.type === '[') {
      index += token.raw.length;
    }
  }
  var options = [];
  if (!token || token.type === '.' || token.type === 'id' ||
      token.type === '[' || token.type === '"' || token.type === '#') {
    // Flatten the options and filter.
    for (var i = 0; i < Code.Explorer.autocompleteData.length; i++) {
      for (var j = 0; j < Code.Explorer.autocompleteData[i].length; j++) {
        var option = Code.Explorer.autocompleteData[i][j];
        if (option.substring(0, prefix.length).toLowerCase() === prefix) {
            options.push(option);
        }
      }
    }
  }
  if ((options.length === 1 && options[0] === prefix) || !options.length) {
    Code.Explorer.hideAutocompleteMenu();
  } else {
    Code.Explorer.showAutocompleteMenu(options, index);
  }
};

/**
 * The last set of autocompletion options from Code City.
 * This is an array of arrays of strings.  The first array contains the
 * properties on the object, the second array contains the properties on the
 * object's prototype, and so on.
 * @type {!Array<!Array<string>>}
 */
Code.Explorer.autocompleteData = [];

/**
 * Remove any properties that are shadowed by objects higher on the inheritance
 * chain.  Also sort the properties alphabetically.
 * @param {Array<!Array<string>>} data Property names from Code City.
 */
Code.Explorer.filterShadowed = function(data) {
  if (!data || data.length < 2) {
    return;
  }
  var properties = Object.create(null);
  for (var i = 0; i < data.length; i++) {
    var datum = data[i];
    for (var j = datum.length - 1; j >= 0; j--) {
      var prop = datum[j];
      if (properties[prop]) {
        datum.splice(j, 1);
      } else {
        properties[prop] = true;
      }
    }
    data[i].sort(Code.Explorer.caseInsensitiveComp);
  }
};

/**
 * Comparison function to sort strings A-Z without regard to case.
 * @param {string} a One string.
 * @param {string} b Another string.
 * @return {number} -1/0/1 comparator value.
 */
Code.Explorer.caseInsensitiveComp = function(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  return (a < b) ? -1 : ((a > b) ? 1 : 0);
};

/**
 * Don't show any autocompletions if the cursor isn't at the end.
 */
Code.Explorer.autocompleteCursorMonitor = function() {
  var input = document.getElementById('input');
  if (typeof input.selectionStart === 'number' &&
      input.selectionStart !== input.value.length) {
    Code.Explorer.hideAutocompleteMenu();
    return true;
  }
  return false;
};

/**
 * Display the autocomplete menu, populated with the provided options.
 * @param {!Array<string>} options Array of options.
 * @param {number} index Left offset (in characters) to position menu.
 */
Code.Explorer.showAutocompleteMenu = function(options, index) {
  if (Code.Explorer.autocompleteCursorMonitor()) {
    return;
  }
  var scrollDiv = document.getElementById('autocompleteMenuScroll');
  scrollDiv.innerHTML = '';
  for (var i = 0; i < options.length; i++) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(options[i]));
    div.addEventListener('mouseover', Code.Explorer.autocompleteMouseOver);
    div.addEventListener('mouseout', Code.Explorer.autocompleteMouseOut);
    div.setAttribute('data-option', options[i]);
    scrollDiv.appendChild(div);
  }
  var menuDiv = document.getElementById('autocompleteMenu');
  menuDiv.style.display = 'block';
  menuDiv.scrollTop = 0;
  var left = Math.round(index * Code.Explorer.SIZE_OF_INPUT_CHARS);
  var maxLeft = window.innerWidth - menuDiv.offsetWidth;
  menuDiv.style.left = Math.min(left, maxLeft) + 'px';
};

/**
 * Stop displaying the autocomplete menu.
 */
Code.Explorer.hideAutocompleteMenu = function() {
  document.getElementById('autocompleteMenu').style.display = 'none';
  Code.Explorer.autocompleteSelect(null);
};

/**
 * Date/time of last keyboard navigation.
 * Don't allow mouse movements to change the autocompletion selection
 * Right after a keyboard navigation.  Otherwise an arrow keypress could cause
 * a scroll which could cause an apparent mouse move, which could cause an
 * unwanted selection change.
 */
Code.Explorer.keyNavigationTime = 0;

/**
 * Highlight one autocomplete option.
 * @param {!Event} e Mouse over event.
 */
Code.Explorer.autocompleteMouseOver = function(e) {
  if (Date.now() - Code.Explorer.keyNavigationTime > 250) {
    Code.Explorer.autocompleteSelect(e.target);
  }
};

/**
 * Remove highlighting from autocomplete option.
 * @param {!Event} e Mouse out event.
 */
Code.Explorer.autocompleteMouseOut = function() {
  if (Date.now() - Code.Explorer.keyNavigationTime > 250) {
    Code.Explorer.autocompleteSelect(null);
  }
};

/**
 * Highlight one option.  Unhighlight all other options.
 * @param {?Element} div Option to highlight or null for none.
 */
Code.Explorer.autocompleteSelect = function(div) {
  var scrollDiv = document.getElementById('autocompleteMenuScroll');
  var cursors = scrollDiv.querySelectorAll('.cursor');
  for (var i = 0, cursor; (cursor = cursors[i]); i++) {
    cursor.className = '';
  }
  if (div) {
    div.className = 'cursor';
  }
};

/**
 * An autocompletion option has been clicked by the user.
 * @param {!Event} e Click event.
 */
Code.Explorer.autocompleteClick = function(e) {
  var option = e.target.getAttribute('data-option');
  var parts = JSON.parse(Code.Explorer.oldInputPartsJSON);
  parts.push(option);
  Code.Explorer.setParts(parts);
};

Code.Explorer.setParts = function(parts) {
  var selector = Code.Common.partsToSelector(parts);
  sessionStorage.setItem(Code.Common.SELECTOR, selector);
  window.parent.postMessage('ping', '*');
};

/**
 * Set the input to be the specified path (e.g. ['$', 'user', 'location']).
 * @param {!Array<string>} parts List of parts.
 */
Code.Explorer.setInput = function(parts) {
  Code.Explorer.hideAutocompleteMenu();
  var value = Code.Common.partsToSelector(parts);
  var input = document.getElementById('input');
  input.value = value;
  input.focus();
  Code.Explorer.oldInputValue = value;  // Don't autocomplete this value.
  Code.Explorer.loadPanels(parts);
};

/**
 * Start polling for changes.
 */
Code.Explorer.inputFocus = function() {
  clearInterval(Code.Explorer.inputPollPid);
  Code.Explorer.inputPollPid = setInterval(Code.Explorer.inputChange, 10);
  Code.Explorer.oldInputValue = null;
};

/**
 * Stop polling for changes.
 */
Code.Explorer.inputBlur = function() {
  if (Code.Explorer.inputBlur.disable_) {
    Code.Explorer.inputBlur.disable_ = false;
    return;
  }
  clearInterval(Code.Explorer.inputPollPid);
  Code.Explorer.hideAutocompleteMenu();
};
Code.Explorer.inputBlur.disable_ = false;

/**
 * When clicking on the autocomplete menu, disable the blur
 * (which would otherwise close the menu).
 */
Code.Explorer.autocompleteMouseDown = function() {
  Code.Explorer.inputBlur.disable_ = true;
};

/**
 * Intercept some control keys to control the autocomplete menu.
 * @param {!Event} e Keypress event.
 */
Code.Explorer.inputKey = function(e) {
  var key = {
    tab: 9,
    enter: 13,
    esc: 27,
    up: 38,
    down: 40
  };
  if (e.keyCode === key.esc) {
    Code.Explorer.hideAutocompleteMenu();
  }
  Code.Explorer.autocompleteCursorMonitor();
  var scrollDiv = document.getElementById('autocompleteMenuScroll');
  var cursor = scrollDiv.querySelector('.cursor');
  var menuDiv = document.getElementById('autocompleteMenu');
  var hasMenu = menuDiv.style.display !== 'none';
  if (e.keyCode === key.enter) {
    if (cursor) {
      var fakeEvent = {target: cursor};
      Code.Explorer.autocompleteClick(fakeEvent);
      e.preventDefault();
    } else {
      var parts = JSON.parse(Code.Explorer.oldInputPartsJSON);
      if (Code.Explorer.oldInputPartsLast &&
          Code.Explorer.oldInputPartsLast.valid) {
        parts.push(Code.Explorer.oldInputPartsLast.value);
      }
      Code.Explorer.setParts(parts);
    }
  }
  if (e.keyCode === key.tab) {
    if (hasMenu) {
      var option = scrollDiv.firstChild;
      var prefix = option.getAttribute('data-option');
      var optionCount = 0;
      do {
        optionCount++;
        prefix = Code.Explorer.getPrefix(prefix,
            option.getAttribute('data-option'));
        option = option.nextSibling;
      } while (option);
      if (optionCount === 1) {
        // There was only one option.  Choose it.
        var parts = JSON.parse(Code.Explorer.oldInputPartsJSON);
        parts.push(prefix);
        Code.Explorer.setParts(parts);
      } else if (Code.Explorer.oldInputPartsLast) {
        if (Code.Explorer.oldInputPartsLast.type === 'id') {
          // Append the common prefix to the input.
          var input = document.getElementById('input');
          input.value = input.value.substring(0,
              Code.Explorer.oldInputPartsLast.index) + prefix;
        }
        // TODO: Tab-completion of partial strings and numbers.
      }
    }
    e.preventDefault();
  }
  if (hasMenu && (e.keyCode === key.up || e.keyCode === key.down)) {
    Code.Explorer.keyNavigationTime = Date.now();
    var newCursor;
    if (e.keyCode === key.up) {
      if (!cursor) {
        newCursor = scrollDiv.lastChild;
      } else if (cursor.previousSibling) {
        newCursor = cursor.previousSibling;
      }
    } else if (e.keyCode === key.down) {
      if (!cursor) {
        newCursor = scrollDiv.firstChild;
      } else if (cursor.nextSibling) {
        newCursor = cursor.nextSibling;
      }
    }
    if (newCursor) {
      Code.Explorer.autocompleteSelect(newCursor);
      if (newCursor.scrollIntoView) {
        newCursor.scrollIntoView({block: 'nearest', inline: 'nearest'});
      }
    }
    e.preventDefault();
  }
};

/**
 * Compute and return the common prefix of two (relatively short) strings.
 * @param {string} str1 One string.
 * @param {string} str2 Another string.
 * @return {string} Common prefix.
 */
Code.Explorer.getPrefix = function(str1, str2) {
  var len = Math.min(str1.length, str2.length);
  for (var i = 0; i < len; i++) {
    if (str1[i] !== str2[i]) {
      break;
    }
  }
  return str1.substring(0, i);
};

/**
 * If the cursor moves away from the end as a result of the mouse,
 * close the autocomplete menu.
 */
Code.Explorer.inputMouseDown = function() {
  setTimeout(autocompleteCursorMonitor, 1);
};

/**
 * Number of object panels.
 */
Code.Explorer.panelCount = 0;

/**
 * Size of temporary spacer margin for smooth scrolling after deletion.
 */
Code.Explorer.panelSpacerMargin = 0;

/**
 * Update the panels with the specified list of parts.
 * @param {!Array<string>} parts List of parts.
 */
Code.Explorer.loadPanels = function(parts) {
  // Store parts in a sessionStorage so that the panels can highlight
  // the current items.
  sessionStorage.setItem('code parts', JSON.stringify(parts));
  for (var i = 0; i <= parts.length; i++) {
    var component = JSON.stringify(parts.slice(0, i));
    var iframe = document.getElementById('objectPanel' + i);
    if (iframe) {
      if (iframe.getAttribute('data-component') === component) {
        // Highlight current item.
        iframe.contentWindow.postMessage('ping', '*');
        continue;
      } else {
        while (Code.Explorer.panelCount > i) {
          Code.Explorer.removePanel();
        }
      }
    }
    iframe = Code.Explorer.addPanel(component);
  }
  while (Code.Explorer.panelCount > i) {
    Code.Explorer.removePanel();
  }
};

/**
 * Add an object panel to the right.
 * @param {string} component Stringified parts list.
 */
Code.Explorer.addPanel = function(component) {
  panelsScroll = document.getElementById('panelsScroll');
  var iframe = document.createElement('iframe');
  iframe.id = 'objectPanel' + Code.Explorer.panelCount;
  iframe.src = '/static/code/objectPanel.html#' + encodeURI(component);
  iframe.setAttribute('data-component', component);
  var spacer = document.getElementById('panelSpacer');
  panelsScroll.insertBefore(iframe, spacer);
  Code.Explorer.panelCount++;
  Code.Explorer.panelSpacerMargin =
      Math.max(0, Code.Explorer.panelSpacerMargin - iframe.offsetWidth);
  Code.Explorer.scrollPanel();
};

/**
 * Remove the right-most panel.
 */
Code.Explorer.removePanel = function() {
  Code.Explorer.panelCount--;
  var iframe = document.getElementById('objectPanel' +
      Code.Explorer.panelCount);
  Code.Explorer.panelSpacerMargin += iframe.offsetWidth;
  iframe.parentNode.removeChild(iframe);
  Code.Explorer.scrollPanel();
};

/**
 * After addition, quickly scroll the panels all the way to see the right edge.
 * After deletion, reduce the spacer so that the panels scroll to the edge.
 */
Code.Explorer.scrollPanel = function() {
  var spacer = document.getElementById('panelSpacer');
  var speed = 20;
  clearTimeout(Code.Explorer.scrollPid_);
  if (Code.Explorer.panelSpacerMargin > 0) {
    // Reduce spacer.
    Code.Explorer.panelSpacerMargin =
        Math.max(0, Code.Explorer.panelSpacerMargin - speed);
    spacer.style.marginRight = Code.Explorer.panelSpacerMargin + 'px';
    if (Code.Explorer.panelSpacerMargin > 0) {
      Code.Explorer.scrollPid_ = setTimeout(Code.Explorer.scrollPanel, 10);
    }
  } else {
    spacer.style.marginRight = 0;
    // Scroll right.
    panels = document.getElementById('panels');
    var oldScroll = panels.scrollLeft;
    panels.scrollLeft += speed;
    if (panels.scrollLeft > oldScroll) {
      Code.Explorer.scrollPid_ = setTimeout(Code.Explorer.scrollPanel, 10);
    }
  }
};

/**
 * PID of currently executing scroll animation.
 * @private
 */
Code.Explorer.scrollPid_ = 0;

/**
 * Page has loaded, initialize the explorer.
 */
Code.Explorer.init = function() {
  var input = document.getElementById('input');
  input.addEventListener('focus', Code.Explorer.inputFocus);
  input.addEventListener('blur', Code.Explorer.inputBlur);
  input.addEventListener('keydown', Code.Explorer.inputKey);
  input.addEventListener('mousedown', Code.Explorer.inputMouseDown);
  var scrollDiv = document.getElementById('autocompleteMenuScroll');
  scrollDiv.addEventListener('mousedown', Code.Explorer.autocompleteMouseDown);
  scrollDiv.addEventListener('click', Code.Explorer.autocompleteClick);
  Code.Explorer.receiveMessage();
};

window.addEventListener('load', Code.Explorer.init);
window.addEventListener('message', Code.Explorer.receiveMessage, false);