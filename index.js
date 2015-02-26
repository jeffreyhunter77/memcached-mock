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
 * Return the equivalent ttl for a key
 */
function keyttl(memcached, key) {
  return cache[key] && cache[key].expires ?
    ((cache[key].expires - Date.now()) / 1000) :
    0;
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
  
  var result = {cas: String(entry.cas)};
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
  
  if (locations)
    this.servers = [].concat(locations);
  else
    this.servers = [];
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
   * Add a key, but only if it does not already exist
   */
  add: function(key, value, ttl, callback) {
    var exists = expire(this, key);
    
    if (!exists)
      setkey(this, key, value, ttl);

    invoke(callback, {self: this,
                      type: 'add',
                      args: arguments,
                      names: ['key', 'value', 'lifetime', 'callback']},
      (!exists ? undefined : notStored()),
      (!exists ? true : false));
  },
  
  /**
   * Update a key, but only if its CAS id matches the provided value
   */
  cas: function(key, value, cas, ttl, callback) {
    var entry = expire(this, key);
    var success = false;
    
    if (entry && String(entry.cas) === cas) {
      setkey(this, key, value, ttl);
      success = true;
    }
    
    invoke(callback, {self: this,
                      type: 'cas',
                      args: arguments,
                      names: ['key', 'value', 'cas', 'lifetime', 'callback']},
      undefined, success);
  },
  
  /**
   * Append a string value to a key, but only if the key already exists
   */
  append: function(key, appendValue, callback) {
    expire(this, key);

    if (cache[key])
      setkey(this, key, String(value(cache[key])) + appendValue, keyttl(this, key));

    invoke(callback, {self: this,
                      type: 'append',
                      args: arguments,
                      names: ['key', 'value', 'callback']},
      (cache[key] ? undefined : notStored()),
      (cache[key] ? true : false));
  },
  
  /**
   * Prepend a string value to a key, but only if the key already exists
   */
  prepend: function(key, prependValue, callback) {
    expire(this, key);

    if (cache[key])
      setkey(this, key, String(prependValue) + value(cache[key]), keyttl(this, key));

    invoke(callback, {self: this,
                      type: 'prepend',
                      args: arguments,
                      names: ['key', 'value', 'callback']},
      (cache[key] ? undefined : notStored()),
      (cache[key] ? true : false));
  },
  
  /**
   * Increment a value by an amount, but only if the key already exists
   */
  incr: function(key, amount, callback) {
    expire(this, key);

    if (cache[key])
      setkey(this, key, Number(value(cache[key])) + amount, keyttl(this, key));

    invoke(callback, {self: this,
                      type: 'incr',
                      args: arguments,
                      names: ['key', 'value', 'callback']},
      undefined,
      (cache[key] ? value(cache[key]) : false));
  },
  
  /**
   * Decrement a value by an amount, but only if the key already exists
   */
  decr: function(key, amount, callback) {
    expire(this, key);

    if (cache[key])
      setkey(this, key, Number(value(cache[key])) - amount, keyttl(this, key));

    invoke(callback, {self: this,
                      type: 'decr',
                      args: arguments,
                      names: ['key', 'value', 'callback']},
      undefined,
      (cache[key] ? value(cache[key]) : false));
  },
  
  /**
   * Delete a key from the cache
   */
  del: function(key, callback) {
    var exists = expire(this, key);
    
    if (exists)
      delete cache[key];

    invoke(callback, {self: this,
                      type: 'delete',
                      args: arguments,
                      names: ['key', 'callback']},
      undefined, (exists ? true : false));
  },

  /**
   * Provide callback an array of server version information
   */
  version: function(callback) {
    invoke(callback, {self: this,
                      type: 'version',
                      args: arguments,
                      names: ['callback']},
      undefined,
      this.servers.map(function(s) {
        return {server: s, version: "1.4.20", major: "1", minor: "4", bugfix: "20"};
      }));
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
  },
  
  /**
   * Provide callback an array of server stats
   */
  stats: function(callback) {
    var info = {
      "pid":1,"uptime":1,"time":Math.round(Date.now()/1000),"version":"1.4.20","libevent":"2.0.22-stable","pointer_size":64,"rusage_user":"0.0","rusage_system":"0.0","curr_connections":1,"total_connections":1,"connection_structures":1,"reserved_fds":0,"cmd_get":0,"cmd_set":0,"cmd_flush":0,"cmd_touch":0,"get_hits":0,"get_misses":0,"delete_misses":0,"delete_hits":0,"incr_misses":0,"incr_hits":0,"decr_misses":0,"decr_hits":0,"cas_misses":0,"cas_hits":0,"cas_badval":0,"touch_hits":0,"touch_misses":0,"auth_cmds":0,"auth_errors":0,"bytes_read":1,"bytes_written":1,"limit_maxbytes":67108864,"accepting_conns":1,"listen_disabled_num":0,"threads":4,"conn_yields":0,"hash_power_level":16,"hash_bytes":524288,"hash_is_expanding":0,"malloc_fails":0,"bytes":0,"curr_items":0,"total_items":0,"expired_unfetched":0,"evicted_unfetched":0,"evictions":0,"reclaimed":0,"crawler_reclaimed":0
    };

    invoke(callback, {self: this,
                      type: 'stats',
                      args: arguments,
                      names: ['callback']},
      undefined,
      this.servers.map(function(s) {
        return extend({server: s}, info);
      }));
  }

});

module.exports = Memcached;
