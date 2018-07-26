/**
 * @license
 * Code City: serialisation to eval-able JS
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
 * @fileoverview Saving the state of the interpreter as eval-able JS.
 * @author cpcallen@google.com (Christohper Allen)
 */
'use strict';

var code = require('./code');
var Interpreter = require('./interpreter');
var Selector = require('./selector');

/**
 * @typedef {{filename: string,
 *            contents: !Array<!ContentEntry>,
 *            rest: boolean}}
 */
var ConfigEntry;

/**
 * @typedef {{filename: string,
 *            contents: (!Array<string|!ContentEntry>|undefined),
 *            rest: (boolean|undefined)}}
 */
var SpecEntry;

/**
 * The type of the values of contents: entries of the config spec.
 * @record
 */
var ContentEntry = function() {};

/**
 * Path is a string like "eval", "Object.prototype" or
 * "$.util.command" identifying the variable or property binding this
 * entry applies to.
 * @type {string}
 */
ContentEntry.prototype.path;

/**
 * Do is what to to do with the specified path.
 * @type {Do}
 */
ContentEntry.prototype.do;

/**
 * Reorder is a boolean (default: false) specifying whether it is
 * acceptable to allow property or set/map entry entries to be created
 * (by the output JS) in a different order than they apear in the
 * interpreter instance being serialised.  If false, output may
 * contain placeholder entries like:
 *
 *     var obj = {};
 *     obj.foo = undefined;  // placeholder
 *     obj.bar = function() { ... };
 *
 * to allow obj.foo to be defined later while still
 * preserving property order.
 * @type {boolean|undefined}
 */
ContentEntry.prototype.reorder;

/**
 * Possible things to do (or have done) with a variable / property
 * binding.  Note that all valid 'do' values are truthy.
 * @enum {number}
 */
var Do = {
  /**
   * Not started yet.  Only valid as a 'done' value, not as a 'do' value.
   */
  UNSTARTED: 0,
  
  /**
   * Skip the named binding entirely (unless it or an extension of it
   * is explicitly mentioned in a later config directive); if the data
   * accessible via the named binding is not accessible via any other
   * (non-pruned) path from the global scope it will consequently not
   * be included in the dump.  This option is intended to cause data
   * loss, so be careful!
   */
  PRUNE: 1,

  /**
   * Skip the named binding for now, but include it in a later file
   * (whichever has rest: true).
   */
  SKIP: 2,

  /**
   * Ensure that the specified path exists, but do not yet set it to
   * its final value.  If the path is a property, it will not (yet) be
   * made non-configurable.
   */
  DECL: 3,

  /**
   * Ensure theat the specified path exists and has been set to its
   * final value (if primitive) or an object of the correct class (if
   * non-primitive).  It will also ensure the final property
   * attributes (enumerable, writable and/or configurable) are set.
   *
   * If a new object is created to be the value of the specified path
   * it will not (yet) have its properties or internal set/map data
   * set (but immutable internal data, such as function code, must be
   * set at this time).
   */
  SET: 4,

  /**
   * Ensure the specified path is has been set to its final value (and
   * marked immuable, if applicable) and that the same has been done
   * recursively to all bindings reachable via path.
   */
  RECURSE: 5,
};

/**
 * @constructor
 */
var ConfigNode = function() {
  /** @type {number|undefined} */
  this.firstFileNo = undefined;
  /** @type {!Object<string, !ConfigNode>} */
  this.kids = Object.create(null);
};

/**
 * @param {string} name
 * @return {ConfigNode}
 */
ConfigNode.prototype.kidFor = function(name) {
  if (!this.kids[name]) {
    this.kids[name] = new ConfigNode;
  }
  return this.kids[name];
};

/**
 * @constructor
 * @param {!Array<SpecEntry>} spec
 */
var Config = function(spec) {
  /** @type {!Array<!ConfigEntry>} */
  this.entries = [];
  /** @type {number|undefined} */
  this.defaultFileNo = undefined;
  /** @type {!ConfigNode} */
  this.tree = new ConfigNode;

  for (var fileNo = 0; fileNo < spec.length; fileNo++) {
    var /** !SpecEntry */ se = spec[fileNo];
    var /** !ConfigEntry */ entry = {
      filename: se.filename,
      contents: [],
      rest: Boolean(se.rest)
    };
    this.entries.push(entry);
    if (se.contents) {
      for (var i = 0; i < se.contents.length; i++) {
        var sc = se.contents[i];
        if (typeof sc === 'string') {
          var /** !ContentEntry */ content =
              {path: sc, do: Do.RECURSE, reorder: false};
        } else {
          content = {path: sc.path, do: sc.do, reorder: Boolean(sc.reorder)};
        }
        entry.contents.push(content);
        var selector = new Selector(content.path);
        var /** ?ConfigNode */ cn = this.tree;
        for (var j = 0; j < selector.length; j++) {
          cn = cn.kidFor(selector[j]);
        }
        // Now cn is final ConfigNode for path (often a leaf).
        cn.firstFileNo = fileNo;
      }
    }
    if (spec[fileNo].rest) {
      if (this.defaultFileNo !== undefined) {
        throw Error('Only one rest entry permitted');
      }
      this.defaultFileNo = fileNo;
    }
  }
};

/**
 * Dump-state information for a single scope or object.  Implemented
 * by ScopeInfo and ObjectInfo.
 * @interface
 */
var Info = function() {
  /**
   * Map of variable or property name -> dump status.
   * @type {!Object<string, Do>}
   */
  this.done;
};

/**
 * Dump-state information for a single scope.
 * @constructor
 * @implements {Info}
 * @param {!Interpreter.Scope} scope The scope to keep state for.
 */
var ScopeInfo = function(scope) {
  this.scope = scope;
  /**
   * Map of variable name -> dump status.
   * @type {!Object<string, Do>}
   */
  this.done = Object.create(null);
};

/**
 * Dump-state information for a single object.
 * @constructor
 * @implements {Info}
 * @param {!Interpreter.prototype.Object} obj The object to keep state for.
 */
var ObjectInfo = function(obj) {
  this.obj = obj;
  /**
   * Referecne to this object, once created.
   * @type {!Selector|undefined}
   */
  this.ref = undefined;
  /**
   * Map of property name -> dump status.
   * @type {!Object<string, Do>}
   */
  this.done = Object.create(null);
};

/**
 * Dumper encapsulates all the state required to keep track of what
 * has and hasn't yet been written when dumping an Interpreter.
 * @constructor
 * @param {!Interpreter} intrp
 * @param {!Array<SpecEntry>} spec
 */
var Dumper = function(intrp, spec) {
  this.intrp = intrp;
  this.config = new Config(spec);
  /** @type {!Map<!Interpreter.Scope,!ScopeInfo>} */
  this.scopeInfo = new Map;
  /** @type {!Map<!Interpreter.prototype.Object,!ObjectInfo>} */
  this.objInfo = new Map;
  /**
   * Which scope are we presently outputting code in the context of?
   * @type {!Interpreter.Scope}
   */
  this.scope = intrp.global;
};

/**
 * Get interned ScopeInfo for sope.
 * @param {!Interpreter.Scope} scope The scope to get info for.
 * @return {!ScopeInfo} The ScopeInfo for scope.
 */
Dumper.prototype.getScopeInfo = function(scope) {
  if (this.scopeInfo.has(scope)) return this.scopeInfo.get(scope);
  var si = new ScopeInfo(scope);
  this.scopeInfo.set(scope, si);
  return si;
};

/**
 * Get interned ObjectInfo for sope.
 * @param {!Interpreter.prototype.Object} obj The object to get info for.
 * @return {!ObjectInfo} The ObjectInfo for obj.
 */
Dumper.prototype.getObjectInfo = function(obj) {
  if (this.objInfo.has(obj)) return this.objInfo.get(obj);
  var oi = new ObjectInfo(obj);
  this.objInfo.set(obj, oi);
  return oi;
};

/**
 * Get the present value in the interpreter of a particular binding,
 * specified by selector.  If selector does not correspond to a valid
 * binding an error is thrown.
 * @param {!Selector} selector A selector, specifiying a binding.
 * @return {Interpreter.Value} The value of that binding.
 */
Dumper.prototype.getValueForSelector = function(selector) {
  if (selector.length < 1) throw RangeError('Zero-length selector??');
  var v = this.intrp.global.get(selector[0]);
  for (var i = 1; i < selector.length; i++) {
    var key = selector[i];
    if (!(v instanceof this.intrp.Object)) {
      throw TypeError("Can't get property '" + key + "' of non-object " + v);
    }
    v = v.get(key, this.intrp.ROOT);
  }
  return v;
};

/**
 * Get a source text to declare and optionally initialise a particular
 * binding.
 * @param {!Selector} selector The selector for the binding to be dumped.
 * @param {Do} todo How much to dump.  Must be >= Do.DECL.
 * @return {string} An eval-able program to initialise the specified binding.
 */
Dumper.prototype.dumpBinding = function(selector, todo) {
  var output = [];
  var /** Info */ info;
  var /** string */ name;

  // Find info for scope/object on which we will be creating a binding.
  if (selector.length < 1) {
    throw RangeError("Can't bind nothing");
  } else if (selector.length === 1) {
    name = selector[0];
    info = this.getScopeInfo(this.scope);
  } else {
    var objSel = new Selector(selector);
    objSel.pop();
    var obj = this.getValueForSelector(objSel);
    if (!(obj instanceof this.intrp.Object)) {
      throw Error("Can't set properties of primitive");
    }
    name = selector[selector.length - 1];
    info = this.getObjectInfo(obj);
  }

  var done = info.done[name] || Do.UNSTARTED;
  var doDecl = (todo >= Do.DECL && done < Do.DECL);
  var doInit = (todo >= Do.SET && done < Do.SET);

  // Begin with var if declaring a variable.
  if (doDecl && selector.length === 1) output.push('var ');
  // Mention name we are declaring / initializing (if we are doing either).
  if (doDecl || doInit) output.push(selector.toExpr());
  // Add initialiser.
  if (doInit) {
    var value = this.getValueForSelector(selector);
    output.push(' = ', this.toExpr(value, selector));
  } else if (doDecl && selector.length > 1) {
    // Can't "declare" a property, but can make sure it exists.
    output.push(' = undefined');
  }
  // End line if non-empty.
  if (output.length > 0) output.push(';\n');
  // Record what we've just done.
  info.done[name] = /** @type {Do} */(Math.max(done, Math.min(todo, Do.SET)));
  return output.join('');
};

/**
 * Get a source text representation of a given value.  The source text
 * will vary depending on the state of the dump; for instance, if the
 * value is an object that has not yet apepared in the dump it will be
 * represented by an expression creating the object - but if it has
 * appeared before, then it will instead be represented by an
 * expression referenceing the previously-constructed object.
 *
 * TODO(cpcallen): rename this (and other *ToExpr) to toSource once
 *     https://github.com/google/closure-compiler/issues/3013 is
 *     fixed.
 * @param {Interpreter.Value} value Arbitrary JS value from this.intrp.
 * @param {Selector=} selector Location in which value will be stored.
 * @return {string} An eval-able representation of the value.
 */
Dumper.prototype.toExpr = function(value, selector) {
  var intrp = this.intrp;
  if (!(value instanceof intrp.Object)) {
    return this.primitiveToExpr(value);
  }

  // Return existing reference to object (if already created).
  var vi = this.getObjectInfo(value);
  if (vi.ref) return vi.ref.toExpr();

  // New object.  Save referece for later use.
  if (!selector) throw Error('Refusing to create non-referable object');
  vi.ref = selector;

  // Object not yet referenced.  Is it a builtin?
  var key = intrp.builtins.getKey(value);
  if (key) return 'new ' + code.quote(key);

  // Object not yet created.
  if (value instanceof intrp.Function) {
    return this.functionToExpr(value);
  } else if (value instanceof intrp.Array) {
    return this.arrayToExpr(value);
  } else if (value instanceof intrp.Date) {
    return this.dateToExpr(value);
  } else if (value instanceof intrp.RegExp) {
    return this.regExpToExpr(value);
  } else {
    return this.objectToExpr(value);
  }
};

/**
 * Get a source text representation of a given primitive value (not
 * including symbols).  Correctly handles having Infinity, NaN and/or
 * undefiend shadowed by binding in the current scope.
 * @param {undefined|null|boolean|number|string} value Primitive JS value.
 * @return {string} An eval-able representation of the value.
 */
Dumper.prototype.primitiveToExpr = function(value) {
  switch (typeof value) {
    case 'undefined':
      if (this.isShadowed('undefined')) return '(void 0)';
      // FALL THROUGH
    case 'boolean':
      return String(value);
    case 'number':
      // All finite values (except -0) will convert back to exactly
      // equal number, but Infinity and NaN could be shadowed.  See
      // https://stackoverflow.com/a/51218373/4969945
      if (Object.is(value, -0)) {
        return '-0';
      } else if (Number.isFinite(value)) {
        return String(value);
      } else if (Number.isNaN(value)) {
        if (this.isShadowed('NaN')) {
          return '(0/0)';
        }
        return 'NaN';
      } else {  // value is Infinity or -Infinity.
        if (this.isShadowed('Infinity')) {
          return (value > 0) ? '(1/0)' : '(-1/0)';
        }
        return String(value);
      }
    case 'string':
      return code.quote(value);
    default:
      if (value === null) {
        return 'null';
      } else {
        throw TypeError('primitiveToSource called on non-primitive value');
      }
  }
};

/**
 * Get a source text representation of a given Object.  May or may not
 * include all properties, etc.
 * @param {!Interpreter.prototype.Object} obj Object to be recreated.
 * @return {string} An eval-able representation of obj.
 */
Dumper.prototype.objectToExpr = function(obj) {
  switch (obj.proto) {
    case this.intrp.OBJECT:
      return '{}';
    case null:
      return 'Object.create(null)';
    default:
      return 'Object.create(' + this.toExpr(obj.proto) + ')';
  }
};

/**
 * Get a source text representation of a given Function object.
 * @param {!Interpreter.prototype.Function} func Function object to be
 *     recreated.
 * @return {string} An eval-able representation of obj.
 */
Dumper.prototype.functionToExpr = function(func) {
  if (!(func instanceof this.intrp.UserFunction)) {
    throw Error('Unable to dump non-UserFunction');
  }
  return func.toString();
};

/**
 * Get a source text representation of a given Array object.
 * @param {!Interpreter.prototype.Array} arr Array object to be recreated.
 * @return {string} An eval-able representation of obj.
 */
Dumper.prototype.arrayToExpr = function(arr) {
  return '[]';
};

/**
 * Get a source text representation of a given Date object.
 * @param {!Interpreter.prototype.Date} date Date object to be recreated.
 * @return {string} An eval-able representation of obj.
 */
Dumper.prototype.dateToExpr = function(date) {
  return "new Date('" + date.date.toISOString() + "')";
};

/**
 * Get a source text representation of a given RegExp object.
 * @param {!Interpreter.prototype.RegExp} re RegExp to be recreated.
 * @return {string} An eval-able representation of obj.
 */
Dumper.prototype.regExpToExpr = function(re) {
  return re.regexp.toString();
};

/**
 * Returns true if a given name is shadowed in the current scope.
 * @param {string} name Variable name that might be shadowed.
 * @param {!Interpreter.Scope=} scope Scope in which name is defind
 *     (default: the global scope).
 * @return {boolean} True iff name is bound in a scope between the
 *     current scope (this.scope) (inclusive) and scope (exclusive).
 */
Dumper.prototype.isShadowed = function(name, scope) {
  scope = scope || this.intrp.global;
  for (var s = this.scope; s !== scope; s = s.outerScope) {
    if (s === null) {
      throw Error("Looking for name '" + name + "' from non-enclosing scope??");
    }
    if (s.hasBinding(name)) return true;
  }
  return false;
};

var dump = function(intrp, spec) {
  var dumper = new Dumper(intrp, spec);
  

};

exports.Do = Do;
exports.dump = dump;

// For unit testing only!
exports.testOnly = {
  Dumper: Dumper,
}
