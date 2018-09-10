/**
 * @license
 * Code City: Registry tests
 *
 * Copyright 2018 Google Inc.
 * https://github.com/NeilFraser/CodeCity
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
 * @fileoverview Unit tests for the Registry class.
 * @author cpcallen@google.com (Christopher Allen)
 */
'use strict';

const Registry = require('../registry');
const {T} = require('./testing');

/**
 * Unit tests for the Interpreter.Registry class.
 * @param {!T} t The test runner object.
 */
exports.testRegistry = function(t) {
  const reg = new Registry;
  const obj = {};
  
  // 0: Initial condition.
  t.expect("reg.has('foo')  // 0", reg.has('foo'), false);
  try {
    reg.get('foo');
    t.fail("reg.get('foo')  // 0", "Didn't throw.");
  } catch(e) {
    t.pass("reg.get('foo')  // 0");
  }
  try {
    reg.getKey(obj);
    t.fail("reg.getKey(obj)  // 0", "Didn't throw.");
  } catch(e) {
    t.pass("reg.getKey(obj)  // 0");
  }

  // 1: Register obj as 'foo'.
  reg.set('foo', obj);
  t.expect("reg.has('foo')  // 1", reg.has('foo'), true);
  t.expect("reg.get('foo')  // 1", reg.get('foo'), obj);
  t.expect("reg.getKey(obj)  // 1", reg.getKey(obj), 'foo');

  // 2: Register another object as 'foo'.
  try {
    reg.set('foo', {});
    t.fail("reg.set('foo', {})  // 2", "Didn't throw.");
  } catch(e) {
    t.pass("reg.set('foo', {})  // 2");
  }
  t.expect("reg.has('foo')  // 2", reg.has('foo'), true);
  t.expect("reg.get('foo')  // 2", reg.get('foo'), obj);
  t.expect("reg.getKey(obj)  // 2", reg.getKey(obj), 'foo');
  try {
    reg.getKey({});
    t.fail("reg.getKey({})  // 2", "Didn't throw.");
  } catch(e) {
    t.pass("reg.getKey({})  // 2");
  }

  // Test iterators.
  // TODO(cpcallen): test with more than one item to iterate over?
  const keys = reg.keys();
  t.expect("reg.keys().length", keys.length, 1);
  t.expect("reg.keys()[0]", keys[0], 'foo');

  const values = reg.values();
  t.expect("reg.values().length", values.length, 1);
  t.expect("reg.values()[0]", values[0], obj);
  
  const entries = reg.entries();
  t.expect("reg.entries().length", entries.length, 1);
  t.expect("reg.entries()[0][0]", entries[0][0], 'foo');
  t.expect("reg.entries()[0][1]", entries[0][1], obj);
};
