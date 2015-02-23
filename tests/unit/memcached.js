/*
 * Copyright (c) 2015 Jeffrey Hunter
 *
 * Distributed under the MIT license. See the LICENSE file distributed
 * with this work for details and restrictions.
 */

var Memcached = require("../../index");

/** Evaluate calling context for callback */
function testContext(test, that, name, args) {
  test.ok(that.hasOwnProperty('start'));
  test.ok(that.start <= Date.now());
  test.ok(that.hasOwnProperty('execution'))
  test.ok(that.execution >= 0);
  
  var expected = {
    start: that.start,
    execution: that.execution,
    callback: args.callback,
    type: name,
    command: null,
    validate: []
  };
  
  Object.keys(args).forEach(function(arg) {
    expected[arg] = args[arg];
    expected.validate.push([arg,null]);
  });
  
  test.deepEqual(that, expected);
}

/** Test basic get and set operations */
module.exports.testGetSet = function(test) {
  var key = '19en8bgbr';
  var value = '19en8c6bs';
  
  var memcached = new Memcached("127.0.0.1:11211");
  
  memcached.get(key, function(err, data) {
    test.ifError(err);
    test.strictEqual(data, undefined);
    
    memcached.set(key, value, 1, function setCallback(err, reply) {
      test.ifError(err);
      testContext(test, this, 'set', {"key": key, "value": value, "lifetime": 1, callback: setCallback});
      test.strictEqual(reply, true);
      
      memcached.get(key, function getCallback(err, data) {
        test.ifError(err);
        test.strictEqual(data, value);
        testContext(test, this, 'get', {"key": key, callback: getCallback});
        test.done();
        
      });
    });
  });
}

/** Test expiration */
module.exports.testSetExpiration = function(test) {
  var key = '19epfu6vj';
  var value = '19epfueu8';
  
  var memcached = new Memcached("127.0.0.1:11211");
  
  memcached.set(key, value, 1, function(err, data) {
    test.ifError(err);
    
    memcached.get(key, function(err, data) {
      test.ifError(err);
      test.strictEqual(data, value);
      
      setTimeout(function() {
        memcached.get(key, function(err, data) {
          test.ifError(err);
          test.strictEqual(data, undefined);
          test.done();
          
        });
        
      }, 1500);
    });
  });
}

/** Test touch */
module.exports.testTouch = function(test) {
  var key = '19eph2mg1';
  var value = '19eph35c8';
  
  var memcached = new Memcached("127.0.0.1:11211");
  
  memcached.set(key, value, 1, function(err, data) {
    test.ifError(err);
    
    memcached.touch(key, 2, function(err, reply) {
      test.ifError(err);
      test.strictEqual(reply, true);
      
      setTimeout(function() {
        memcached.get(key, function(err, data) {
          test.ifError(err);
          test.strictEqual(data, value);
          test.done();
          
        });
        
      }, 1500);
    });
  });
}

/** Test touch non-existent key */
module.exports.testTouchNonExistent = function(test) {
  var key = '19epr4uj1';
  
  var memcached = new Memcached("127.0.0.1:11211");
  
  memcached.touch(key, 1, function(err, reply) {
    test.ifError(err);
    test.strictEqual(reply, false);
    test.done();
    
  });
}

/** Test gets */
module.exports.testGets = function(test) {
  var key = '19epmksqm';
  var value = '19epml3p7';
  
  var memcached = new Memcached("127.0.0.1:11211");
  
  memcached.set(key, value, 1, function(err, data) {
    test.ifError(err);
    test.strictEqual(data, true);
    
    memcached.gets(key, function getsCallback(err, data) {
      test.ifError(err);
      testContext(test, this, 'gets', {"key": key, callback: getsCallback});
      test.ok(data.hasOwnProperty('cas'));
      test.ok(data.cas > 1);
      
      var expected = {cas: data.cas};
      expected[key] = value;
      test.deepEqual(data, expected);
      test.done();
      
    });
  });
}

/** Test getMutli */
module.exports.testGetMulti = function(test) {
  var keys = ['19epo6uuj', '19epo77eh', '19epo7jp8'];
  var values = ['19epo7tqc', '19epo882f', '19epo8ek8'];
  var toSet = [0, 1, 2];
  
  var memcached = new Memcached("127.0.0.1:11211");
  
  function setNext(err) {
    test.ifError(err);
    
    if (toSet.length > 0)
      memcached.set(keys[toSet[0]], values[toSet.shift()], 1, setNext);
    else
      getAll();
  }
  
  function getAll() {
    memcached.getMulti(keys, function getMultiCallback(err, data) {
      test.ifError(err);
      // global context is used by memcached for this call
      
      var expected = {};
      keys.forEach(function(key, idx) { expected[key] = values[idx]; });
      
      test.deepEqual(expected, data);
      test.done();
      
    });
  }
  
  setNext();
}

/** Test get with array */
module.exports.testGetWithArray = function(test) {
  var keys = ['19epp4imt', '19epp4rt5', '19epp555h'];
  var values = ['19epp5fe3', '19epp5s4c', '19epp688v'];
  var toSet = [0, 1, 2];
  
  var memcached = new Memcached("127.0.0.1:11211");
  
  function setNext(err) {
    test.ifError(err);
    
    if (toSet.length > 0)
      memcached.set(keys[toSet[0]], values[toSet.shift()], 1, setNext);
    else
      getAll();
  }
  
  function getAll() {
    memcached.get(keys, function getMultiCallback(err, data) {
      test.ifError(err);
      // global context is used by memcached for this call
      
      var expected = {};
      keys.forEach(function(key, idx) { expected[key] = values[idx]; });
      
      test.deepEqual(expected, data);
      test.done();
      
    });
  }
  
  setNext();
}

/** Test successful replace */
module.exports.testReplaceSuccess = function(test) {
  var key = '19ept1qon';
  var value1 = '19ept7un3';
  var value2 = '19ept96oc';
  
  var memcached = new Memcached("127.0.0.1:11211");
  
  memcached.set(key, value1, 1, function(err) {
    test.ifError(err);
    
    memcached.replace(key, value2, 1, function replaceCallback(err, reply) {
      test.ifError(err);
      testContext(test, this, 'replace', {"key": key, "value": value2, "lifetime": 1, callback: replaceCallback});
      test.strictEqual(reply, true);
      
      memcached.get(key, function(err, data) {
        test.ifError(err);
        test.strictEqual(data, value2);
        test.done();
        
      });
    });
  });
}

/** Test unsuccessful replace */
module.exports.testReplaceFailure = function(test) {
  var key = '19eptdnq3';
  var value = '19epteo37';
  
  var memcached = new Memcached("127.0.0.1:11211");
  
  memcached.replace(key, value, 1, function replaceCallback(err, reply) {
    test.ok(err);
    test.strictEqual(err.notStored, true);
    test.strictEqual(err.message, "Item is not stored");
    testContext(test, this, 'replace', {"key": key, "value": value, "lifetime": 1, callback: replaceCallback});
    test.strictEqual(reply, false);
    
    memcached.get(key, function(err, data) {
      test.ifError(err);
      test.strictEqual(data, undefined);
      test.done();
      
    });
  });
}
