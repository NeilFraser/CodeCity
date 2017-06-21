/**
 * @license
 * Code City: serialization and deserialization for JavaScript Intepreter.
 *
 * Copyright 2017 Google Inc.
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
 * @fileoverview Saving and restoring the state of a JS-Intepreter.
 * @author fraser@google.com (Neil Fraser)
 */
'use strict';

function deserialize(json, interpreter) {
  var stack = interpreter.stateStack;
  if (!Array.isArray(json)) {
    throw 'Top-level JSON is not a list.';
  }
  if (!stack.length) {
    // Require native functions to be present.
    throw 'Interpreter must be initialized prior to deserialization.';
  }
  // Find all native functions in existing interpreter.
  var objectList = [];
  objectHunt_(stack, objectList);
  var functionHash = Object.create(null);
  for (var i = 0; i < objectList.length; i++) {
    if (typeof objectList[i] == 'function') {
      functionHash[objectList[i].id] = objectList[i];
    }
  }
  // Get a handle on Acorn's node_t object.
  var nodeProto = stack[0].node.constructor.prototype;
  // First pass: Create object stubs for every object.
  objectList = [];
  for (var i = 0; i < json.length; i++) {
    var jsonObj = json[i];
    var obj;
    switch (jsonObj['type']) {
      case 'Map':
        obj = Object.create(null);
        break;
      case 'Object':
        obj = {};
        break;
      case 'Function':
        obj = functionHash[jsonObj['id']];
        if (!obj) {
          throw 'Function ID not found: ' + jsonObj['id'];
        }
        break;
      case 'Array':
        obj = Array.from(jsonObj['data']);
        break;
      case 'Set':
        // Currently we assume that Sets do not contain objects.
        obj = new Set(jsonObj['data']);
        break;
      case 'Date':
        obj = new Date(jsonObj['data']);
        if (isNaN(obj)) {
          throw 'Invalid date: ' + jsonObj['data'];
        }
        break;
      case 'RegExp':
        obj = RegExp(jsonObj['source'], jsonObj['flags']);
        break;
      case 'Scope':
        obj = new Interpreter.Scope(null);
        break;
      case 'PseudoObject':
        obj = new Interpreter.Object(null);
        break;
      case 'PseudoPrimitive':
        obj = interpreter.createPrimitive(jsonObj['data']);
        break;
      case 'Node':
        obj = Object.create(nodeProto);
        break;
      default:
        throw 'Unknown type: ' + jsonObj['type'];
    }
    objectList[i] = obj;
  }
  // Second pass: Populate properties for every object.
  var ref;
  for (var i = 0; i < json.length; i++) {
    var obj = objectList[i];
    // Repopulate objects.
    var props = json[i]['props'];
    if (props) {
      var names = Object.getOwnPropertyNames(props);
      for (var j = 0; j < names.length; j++) {
        var name = names[j];
        var value = props[name];
        if (value && typeof value == 'object' && (ref = value['#'])) {
          var value = objectList[ref];
          if (!value) {
            throw 'Object reference not found: ' + ref;
          }
        }
        obj[name] = value;
      }
    }
    // Repopulate arrays.
    if (Array.isArray(obj)) {
      for (var j = 0; j < obj.length; j++) {
        var value = obj[j];
        if (value && typeof value == 'object' && (ref = value['#'])) {
          var value = objectList[ref];
          if (!value) {
            throw 'Object reference not found: ' + ref;
          }
        }
        obj[j] = value;
      }
    }
  }
  // First object is the stack.
  interpreter.stateStack = objectList[0];
}

function serialize(interpreter) {
  var stack = interpreter.stateStack;
  // Find all objects.
  var objectList = [];
  objectHunt_(stack, objectList);
  // Get a handle on Acorn's node_t object.
  var nodeProto = stack[0].node.constructor.prototype;
  // Serialize every object.
  var json = [];
  for (var i = 0; i < objectList.length; i++) {
    var jsonObj = Object.create(null);
    json.push(jsonObj);
    var obj = objectList[i];
    switch (Object.getPrototypeOf(obj)) {
      case null:
        jsonObj['type'] = 'Map';
        break;
      case Object.prototype:
        jsonObj['type'] = 'Object';
        break;
      case Function.prototype:
        jsonObj['type'] = 'Function';
        jsonObj['id'] = obj.id;
        if (obj.id === undefined) {
          throw 'Native function has no ID: ' + obj;
        }
        continue;  // No need to index properties.
      case Array.prototype:
        jsonObj['type'] = 'Array';
        var data = Array.from(obj);
        for (var j = 0; j < data.length; j++) {
          var value = data[j];
          if (value && (typeof value == 'object' ||
                        typeof value == 'function')) {
            var ref = objectList.indexOf(value);
            if (ref == -1) {
              throw 'Object not found in table.';
            }
            data[j] = {'#': ref};
          }
        }
        jsonObj['data'] = data;
        continue;  // No need to index properties.
      case Set.prototype:
        // Currently we assume that Sets do not contain objects.
        jsonObj['type'] = 'Set';
        if (obj.size) {
          jsonObj['data'] = Array.from(obj.values());
        }
        continue;  // No need to index properties.
      case Date.prototype:
        jsonObj['type'] = 'Date';
        jsonObj['data'] = obj.toJSON();
        continue;  // No need to index properties.
      case RegExp.prototype:
        jsonObj['type'] = 'RegExp';
        jsonObj['source'] = obj.source;
        jsonObj['flags'] = obj.flags;
        continue;  // No need to index properties.
      case Interpreter.Scope.prototype:
        jsonObj['type'] = 'Scope';
        break;
      case Interpreter.Object.prototype:
        jsonObj['type'] = 'PseudoObject';
        break;
      case Interpreter.Primitive.prototype:
        jsonObj['type'] = 'PseudoPrimitive';
        jsonObj['data'] = obj.data;
        continue;  // No need to index properties.
      case nodeProto:
        jsonObj['type'] = 'Node';
        break;
      default:
        throw 'Unknown type: ' + obj;
    }
    var props = Object.create(null);
    var names = Object.getOwnPropertyNames(obj);
    for (var j = 0; j < names.length; j++) {
      var name = names[j];
      var value = obj[name];
      if (value && (typeof value == 'object' || typeof value == 'function')) {
        var ref = objectList.indexOf(value)
        if (ref == -1) {
          throw 'Object not found in table.';
        }
        props[name] = {'#': ref};
      } else {
        props[name] = value;
      }
    }
    if (names.length) {
      jsonObj['props'] = props;
    }
  }
  return json;
}

// Recursively search the stack to find all non-primitives.
function objectHunt_(node, objectList) {
  if (node && (typeof node == 'object' || typeof node == 'function')) {
    if (objectList.indexOf(node) != -1) {
      return;
    }
    var names = Object.getOwnPropertyNames(node);
    objectList.push(node);
    for (var i = 0; i < names.length; i++) {
      objectHunt_(node[names[i]], objectList);
    }
  }
}
