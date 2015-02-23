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
 * Handle expiration of an entry with a given key. Returns the entry if
 * it has not expired.
 */
function expire(memcached, key) {
  if (cache[key] && cache[key].expires <= Date.now())
    delete cache[key];
  
  return cache[key];
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
 * Sets the value of a key
 */
function setkey(memcached, key, value, ttl) {
  cache[key] = {value: value, expires: expires(memcached, ttl), cas: (++cas)};
}

/**
 * Returns a not stored error
 */
function notStored() {
  var e = new Error("Item is not stored");
  e.notStored = true;
  return e;
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
    expire(this, key);
    
    if (cache[key]) cache[key].expires = expires(this, ttl);
    
    invoke(callback, {self: this,
                      type: 'touch',
                      args: arguments,
                      names: ['key', 'lifetime', 'callback']},
      undefined, (cache[key] ? true : false));
  },

  /**
   * Get the value of a given key
   */
  get: function(key, callback) {
    if (Array.isArray(key)) return this.getMulti(key, callback);

    invoke(callback, {self: this,
                      type: 'get',
                      args: arguments,
                      names: ['key', 'callback']},
      undefined, value(expire(this, key)));
  },

  /**
   * Set the value of a given key
   */
  set: function(key, value, ttl, callback) {
    setkey(this, key, value, ttl);
    
    invoke(callback, {self: this,
                      type: 'set',
                      args: arguments,
                      names: ['key', 'value', 'lifetime', 'callback']},
      undefined, true);
  },
  
  /**
   * Get the value of a given key and its CAS id
   */
  gets: function(key, callback) {
    invoke(callback, {self: this,
                      type: 'gets',
                      args: arguments,
                      names: ['key', 'callback']},
      undefined, casvalue(key, expire(this, key)));
  },
  
  /**
   * Get multiple values in a single call
   */
  getMulti: function(keys, callback) {
    var results = {};
    
    keys.forEach(function(key) {
      if (expire(this, key))
        results[key] = value(cache[key]);
    });
    
    invoke(callback, {self: this,
                      type: 'getMulti',
                      args: arguments,
                      names: ['keys', 'callback']},
      undefined, results);
  },
  
  /**
   * Replace a key, but only if it already exists
   */
  replace: function(key, value, ttl, callback) {
    expire(this, key);

    if (cache[key])
      setkey(this, key, value, ttl);

    invoke(callback, {self: this,
                      type: 'replace',
                      args: arguments,
                      names: ['key', 'value', 'lifetime', 'callback']},
      (cache[key] ? undefined : notStored()),
      (cache[key] ? true : false));
  },
  
  /**
   * Flush the contents of the cache
   */
  flush: function(callback) {
    cache = {};

    invoke(callback, {self: this,
                      type: 'flush',
                      args: arguments,
                      names: ['callback']},
      undefined, [true]);
  }

});

module.exports = Memcached;
