/**
 * @license
 * Code City: Code.
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

/**
 * If not otherwise specified, what should /code point at?
 */
Code.DEFAULT = '$';

/**
 * Raw string of selector.
 * E.g. '$.foo["bar"]'
 */
Code.selector = location.search ?
    decodeURI(location.search.substring(1)) : Code.DEFAULT;

/**
 * Got a ping from someone.  Check sessionStorage to see if selector has
 * changed and, if so, propagate ping to subframes.
 * @param {?Event} event Message event, or null if called from popState.
 */
Code.receiveMessage = function(event) {
  // Check to see if the stored values have changed.
  var selector = sessionStorage.getItem(Code.Common.SELECTOR);
  if (selector === Code.selector) {
    return;
  }
  Code.selector = selector;
  if (event) {
    // Change the URL if this is NOT the result of a forwards/back navigation.
    history.pushState(selector, selector, '/code?' + encodeURI(selector));
  }
  // Propagate the ping down the tree of frames.
  try {
    document.getElementById('explorer').contentWindow.postMessage('ping', '*');
  } catch (e) {
    // Maybe explorer frame hasn't loaded yet.
  }
  try {
    document.getElementById('editor').contentWindow.postMessage('ping', '*');
  } catch (e) {
    // Maybe editor frame hasn't loaded yet.
  }
};

/**
 * User has navigated forwards or backwards.
 * @param {!Event} event History change event.
 */
Code.popState = function(event) {
  var selector = event.state || Code.DEFAULT;
  sessionStorage.setItem(Code.Common.SELECTOR, selector);
  // Attempt to pull the focus away from the explorer's input field.
  // This will allow it to update the displayed selector.
  try {
    document.getElementById('explorer').contentDocument
        .getElementById('input').blur();
  } catch (e) {
    console.log('Unable to blur input: ' + e);
  }
  Code.receiveMessage(null);
};

sessionStorage.setItem(Code.Common.SELECTOR, Code.selector);
window.addEventListener('message', Code.receiveMessage, false);
window.addEventListener('popstate', Code.popState, false);
