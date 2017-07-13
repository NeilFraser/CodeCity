/**
 * @license
 * Code City: Interpreter JS Tests
 *
 * Copyright 2017 Google Inc.
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
 * @fileoverview Serialization/deserialization tests for JavaScript interpreter.
 * @author fraser@google.com (Neil Fraser)
 */
'use strict';

const Interpreter = require('../interpreter');
const autoexec = require('../autoexec');
const Serializer = require('../serialize');
const util = require('util');

/**
 * Run a roundtrip test:
 * - Create an interpreter instance.
 * - Append src1 and run specified number of steps.
 * - Serialize interpreter to JSON.
 * - Create new interpreter instance and deserialize JSON into it.
 * - Run new instance to completion.
 * - Append src2 (if specified) and run that to completion.
 * - Verify result is as expected.
 * @param {!T} t The test runner object.
 * @param {string} name The name of the test.
 * @param {string} src1 The code to be evaled before serialization.
 * @param {string} src2 The code to be evaled after serialization.
 * @param {number|string|boolean|null|undefined} expected The expected
 *     completion value.
 * @param {number=} stesp How many steps to run before serializing
 *     (run to completion if unspecified).
 */
function runTest(t, name, src1, src2, expected, steps) {
  try {
    var intrp1 = new Interpreter;
    intrp1.appendCode(autoexec);
    intrp1.run();
    if (src1) {
      intrp1.appendCode(src1);
      if (steps !== undefined) {
        for (var i = 0; i < steps; i++) {
          intrp1.step();
        }
      } else {
        intrp1.run();
      }
    }
  } catch (e) {
    t.crash(name + 'Pre', e);
    return;
  }

  try {
    var json = JSON.stringify(Serializer.serialize(intrp1));
  } catch (e) {
    t.crash(name + 'Serialize', e);
    return;
  }

  try {
    var intrp2 = new Interpreter;
    Serializer.deserialize(JSON.parse(json), intrp2);
  } catch (e) {
    t.crash(name + 'Deserialize', e);
    return;
  }

  try {
    intrp2.run();
    if (src2) {
      intrp2.appendCode(src2);
      intrp2.run();
    }
  } catch (e) {
    t.crash(name + 'Post', e);
    return;
  }
  
  var r = intrp2.pseudoToNative(intrp2.value);
  if (Object.is(r, expected)) {
    t.pass(name);
  } else {
    t.fail(name, util.format(
        '%s\n/* roundtrip */\n%s\ngot: %s  want: %s',
        src1, src2, String(r), String(expected)));
  }
};

/**
 * Run a round trip serialization-deserialization.
 * @param {T} t The test runner object.
 */
exports.testRoundtripSimple = function(t) {
  runTest(t, 'testRoundtripSimple', `
      var x = 1;
      for (var i = 0; i < 8; i++) {
        x *= 2;
      }
      x;
  `, '', 256, 100);
};
