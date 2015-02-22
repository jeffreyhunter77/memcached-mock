/*
 * Copyright (c) 2015 Jeffrey Hunter
 *
 * Distributed under the MIT license. See the LICENSE file distributed
 * with this work for details and restrictions.
 */

var util = require('util')
  , events = require('events')
;

var cache = {};
var cas = 1;

/**
 * Simple object merge function (shallow merge)
 */
function extend(dest, src) {
  if (src) Object.keys(src).forEach(function(k) { dest[k] = src[k]; });
  
  if (arguments.length <= 2) return dest;

  return extend.apply(this, [dest].concat(Array.prototype.slice.call(arguments, 2)));
}

/**
 * Return the expiration time from a TTL in seconds
 */
function expires(memcached, ttl) {
  return Date.now() + (Number(ttl) * 1000);
}

/**
 * Return the normalized value for a cache entry
 */
function value(entry) {
  return entry ? entry.value : entry;
}

/**
 * Return the normalized value for a cache entry along with its CAS id
 */
function casvalue(key, entry) {
  if (!entry) return;
  
  var result = {cas: entry.cas};
  result[key] = entry.value;

  return result;
}

/**
 * Invoke a callback with the correct context
 */
function invoke(callback, info) {
  var args = Array.prototype.slice.call(arguments, 2);
  var ctx = {
    start: Date.now(),
    type: info.type,
    command: null,
    validate: []
  };

  info.names.forEach(function(name, idx) {
    ctx[name] = info.args[idx];
    ctx.validate.push([name,null]);
  });

  process.nextTick(function() {
    ctx.execution = Date.now() - ctx.start;
    callback.apply(ctx, args);
  });
}


/**
 * Mock Memcached class
 */
function Memcached(locations, options) {
  events.EventEmitter.call(this);
}

util.inherits(Memcached, events.EventEmitter);

extend(Memcached.prototype, {
  
  /**
   * Touch a given key
   */
  touch: function(key, ttl, callback) {
    cache[key] = extend({}, cache[key], {expires: expires(this, ttl)});
    invoke(callback, {self: this,
                      type: 'touch',
                      args: arguments,
                      names: ['key', 'lifetime', 'callback']});
  },

  /**
   * Get the value of a given key
   */
  get: function(key, callback) {
    if (Array.isArray(key)) return this.getMulti(key, callback);

    if (cache[key] && cache[key].expires <= Date.now())
      delete cache[key];
    
    invoke(callback, {self: this,
                      type: 'get',
                      args: arguments,
                      names: ['key', 'callback']},
      undefined, value(cache[key]));
  },

  /**
   * Set the value of a given key
   */
  set: function(key, value, ttl, callback) {
    cache[key] = {value: value, expires: expires(this, ttl), cas: (++cas)};
    invoke(callback, {self: this,
                      type: 'set',
                      args: arguments,
                      names: ['key', 'value', 'lifetime', 'callback']});
  },
  
  /**
   * Get the value of a given key and its CAS id
   */
  gets: function(key, callback) {
    if (cache[key] && cache[key].expires <= Date.now())
      delete cache[key];
    
    invoke(callback, {self: this,
                      type: 'gets',
                      args: arguments,
                      names: ['key', 'callback']},
      undefined, casvalue(key, cache[key]));
  },
  
  /**
   * Get multiple values in a single call
   */
  getMulti: function(keys, callback) {
    var results = {};
    
    keys.forEach(function(key) {
      if (cache[key] && cache[key].expires > Date.now())
        results[key] = value(cache[key]);
    });
    
    invoke(callback, {self: this,
                      type: 'getMulti',
                      args: arguments,
                      names: ['keys', 'callback']},
      undefined, results);
  }

});

module.exports = Memcached;