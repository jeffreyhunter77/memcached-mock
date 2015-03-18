/*
 * Copyright (c) 2015 Jeffrey Hunter
 *
 * Distributed under the MIT license. See the LICENSE file distributed
 * with this work for details and restrictions.
 */

var util = require('util')
  , events = require('events')
;

var _cache = {};
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
  if (ttl === 0) return 0;
  if (ttl > memcached.maxExpiration) return Number(ttl);
  return Date.now() + (Number(ttl) * 1000);
}

/**
 * Handle expiration of an entry with a given key. Returns the entry if
 * it has not expired.
 */
function expire(memcached, key) {
  var cache = memcached.cache();
  
  if (cache[key] && cache[key].expires !== 0 && cache[key].expires <= Date.now())
    delete cache[key];
  
  return cache[key];
}

/**
 * Return the equivalent ttl for a key
 */
function keyttl(memcached, key) {
  var cache = memcached.cache();

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
  var cache = memcached.cache();

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
  extend(this, Memcached.config, options);
  
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
    
    var cache = this.cache();

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
    var self = this;
    var cache = this.cache();
    var results = {};
    
    keys.forEach(function(key) {
      if (expire(self, key))
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

    var cache = this.cache();

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

    var cache = this.cache();

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

    var cache = this.cache();

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

    var cache = this.cache();

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

    var cache = this.cache();

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
    
    var cache = this.cache();

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
    var c = this.cache();

    Object.keys(c).forEach(function(k) { delete c[k]; });

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
  },

  /**
   * Provide callback an array of server settings
   */
  settings: function(callback) {
    var info = {
      "maxbytes":67108864,"maxconns":1024,"tcpport":11211,"udpport":11211,"inter":"NULL","verbosity":0,"oldest":13516,"evictions":"on","domain_socket":"NULL","umask":700,"growth_factor":"1.25","chunk_size":48,"num_threads":4,"num_threads_per_udp":4,"stat_key_prefix":":","detail_enabled":"no","reqs_per_event":20,"cas_enabled":"yes","tcp_backlog":1024,"binding_protocol":"auto-negotiate","auth_enabled_sasl":"no","item_size_max":1048576,"maxconns_fast":"no","hashpower_init":0,"slab_reassign":"no","slab_automove":0,"lru_crawler":"no","lru_crawler_sleep":100,"lru_crawler_tocrawl":0,"tail_repair_time":0,"flush_enabled":"yes","hash_algorithm":"jenkins"
    };

    invoke(callback, {self: this,
                      type: 'settings',
                      args: arguments,
                      names: ['callback']},
      undefined,
      this.servers.map(function(s) {
        return extend({server: s}, info);
      }));
  },

  /**
   * Provide callback an array of server slab information
   */
  slabs: function(callback) {
    var info = {
      "1":{"chunk_size":96,"chunks_per_page":10922,"total_pages":1,"total_chunks":10922,"used_chunks":0,"free_chunks":10922,"free_chunks_end":0,"mem_requested":0,"get_hits":0,"cmd_set":0,"delete_hits":0,"incr_hits":0,"decr_hits":0,"cas_hits":0,"cas_badval":0,"touch_hits":0},"active_slabs":{"undefined":1},"total_malloced":{"undefined":1048512}
    };

    invoke(callback, {self: this,
                      type: 'slabs',
                      args: arguments,
                      names: ['callback']},
      undefined,
      this.servers.map(function(s) {
        return extend({server: s}, info);
      }));
  },

  /**
   * Provide callback an array of server items information
   */
  items: function(callback) {
    var cache = this.cache();
    var len = Object.keys(cache).length;
    
    var info = len === 0 ? {} :
      {"1":{"number":len,"age":1,"evicted":0,"evicted_nonzero":0,"evicted_time":0,"outofmemory":0,"tailrepairs":0,"reclaimed":0,"expired_unfetched":0,"evicted_unfetched":0,"crawler_reclaimed":0}}
    ;

    invoke(callback, {self: this,
                      type: 'info',
                      args: arguments,
                      names: ['callback']},
      undefined,
      this.servers.map(function(s) {
        return extend(len > 0 ? {server: s} : {}, info);
      }));
  },
  
  /**
   * Provide callback with a set of cachedump information
   */
  cachedump: function(server, slabid, limit, callback) {
    var cache = this.cache();
    var items = Object.keys(cache).map(function(key) {
      return {key: key,
              b: String(cache[key].value).length,
              s: Math.round(cache[key].expires/1000)};
    });
    
    function result() {
      switch(items.length) {
        case 0: return;
        case 1: return items[0];
        default: return items;
      };
    }
    
    invoke(callback, {self: this,
                      type: 'cachedump',
                      args: arguments,
                      names: ['server', 'slabid', 'number', 'callback']},
      undefined, result());
  },
  
  /**
   * End the memcached connection
   */
  end: function() {
  },
  
  /**
   * Directly access the mock cache
   */
  cache: function(newCache) {
    if (arguments.length > 0)
      this._cache = newCache;
    
    return this.hasOwnProperty('_cache') ? this._cache : _cache;
  }

});


/**
 * Config options
 */
Memcached.config = {
  maxKeySize: 250,
  maxExpiration: 2592000,
  maxValue: 1048576,
  poolSize: 10,
  algorithm: 'md5',
  reconnect: 18000000,
  timeout: 5000,
  retries: 5,
  failures: 5,
  retry: 30000,
  remove: false,
  keyCompression: true,
  idle: 5000
};

module.exports = Memcached;
